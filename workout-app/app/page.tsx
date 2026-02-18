'use client';

/* eslint-disable @typescript-eslint/no-unused-vars */
// Wake Lock API type (not in all TS libs)
interface WakeLockSentinel { released: boolean; release: () => Promise<void>; }

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';

// ============================================================================
// TYPES
// ============================================================================

type LiftKey = 'bench' | 'squat' | 'deadlift' | 'ohp' | 'row';
type DayType = 'Chest & Triceps' | 'Back & Biceps' | 'Legs' | 'Arms';

type Setup = {
  name?: string;
  gender: string;
  heightIn: number;
  weightLb: number;
  goal: 'Hypertrophy' | 'Strength' | 'Health';
  fiveRM: Record<LiftKey, number>;
};

type Exercise = {
  id: string;
  name: string;
  primary: LiftKey | 'accessory';
  muscleGroups: string[];
  sets: number;
  reps: string;
  targetWeightLb?: number;
  notes?: string;
};

type ExerciseLog = {
  exerciseId: string;
  actualWeightLb?: number;
  actualReps?: string;
  rpe?: number;
  notes?: string;
};

type Session = {
  id: string;
  dateISO: string;
  dayType: DayType;
  muscleGroups: string[];
  energy: number;
  difficulty: number;
  sleepHours?: number;
  workout: Exercise[];
  logs: ExerciseLog[];
  completed?: boolean;
};

type RestTimerPreferences = {
  enabled: boolean;
  compoundSeconds: number;
  accessorySeconds: number;
  isolationSeconds: number;
  autoStart: boolean;
  vibrate: boolean;
  sound: boolean;
};

type UserProfile = {
  id: string;
  displayName: string;
  avatarColor: string;
  createdAt: string;
  lastActiveAt: string;
  setup: Setup | null;
  history: Session[];
  preferences: { theme: 'dark' | 'light'; units: 'imperial' | 'metric' };
  restTimerPrefs?: RestTimerPreferences;
};

type AppState = { profiles: UserProfile[]; activeProfileId: string | null };

// ============================================================================
// CONSTANTS
// ============================================================================

const LS_KEY = 'flex_app_v2';
const OLD_LS_KEY = 'workout_mvp_v1';
const AVATAR_COLORS = ['#64c8ff','#f472b6','#fbbf24','#6ee7b7','#c084fc','#fb923c','#4ade80','#60a5fa','#f87171','#a7f3d0'];
const LIFT_COLORS: Record<LiftKey, string> = { bench:'#64c8ff', squat:'#f472b6', deadlift:'#fbbf24', ohp:'#6ee7b7', row:'#c084fc' };
const LIFT_NAMES: Record<LiftKey, string> = { bench:'Bench', squat:'Squat', deadlift:'Deadlift', ohp:'OHP', row:'Row' };
const ENERGY_EMOJIS = ['😴','😔','😐','😊','💪','🔥'];
const SLEEP_OPTIONS = ['< 5h','5-6h','6-7h','7-8h','8h+'];
const SLEEP_VALUES = [4.5, 5.5, 6.5, 7.5, 8.5];

const DEFAULT_REST_PREFS: RestTimerPreferences = {
  enabled: true,
  compoundSeconds: 150,   // 2:30
  accessorySeconds: 90,   // 1:30
  isolationSeconds: 60,   // 1:00
  autoStart: true,
  vibrate: true,
  sound: true,
};

const REST_PRESETS = [
  { label: '0:30', seconds: 30 },
  { label: '1:00', seconds: 60 },
  { label: '1:30', seconds: 90 },
  { label: '2:00', seconds: 120 },
  { label: '2:30', seconds: 150 },
  { label: '3:00', seconds: 180 },
];

// ============================================================================
// UTILITIES
// ============================================================================

function uid(prefix = 'id') { return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`; }
function estimate1RMFrom5RM(fiveRM: number) { return fiveRM * (1 + 5 / 30); }
function trainingMax(oneRM: number) { return oneRM * 0.9; }
function roundTo2_5(x: number) { return Math.round(x / 2.5) * 2.5; }
function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }
function formatDate(iso: string) { return new Date(iso).toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' }); }
function formatDateShort(iso: string) { return new Date(iso).toLocaleDateString(undefined, { month:'short', day:'numeric' }); }
function getWeekNumber(date: Date): string {
  const s = new Date(date.getFullYear(), 0, 1);
  const d = Math.floor((date.getTime() - s.getTime()) / 86400000);
  return `W${Math.ceil((d + s.getDay() + 1) / 7)} ${date.getFullYear()}`;
}
function getDaysBetween(a: Date, b: Date) { return Math.round(Math.abs((a.getTime() - b.getTime()) / 86400000)); }

function getRestDuration(exercise: Exercise, prefs: RestTimerPreferences): number {
  if (exercise.primary !== 'accessory') return prefs.compoundSeconds;
  const name = exercise.name.toLowerCase();
  const isIsolation = name.includes('curl') || name.includes('lateral') || name.includes('face pull') || name.includes('calf') || name.includes('pushdown') || name.includes('extension');
  return isIsolation ? prefs.isolationSeconds : prefs.accessorySeconds;
}
function getRelativeTime(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return 'Today'; if (d === 1) return 'Yesterday';
  if (d < 7) return `${d}d ago`; if (d < 30) return `${Math.floor(d/7)}w ago`;
  return formatDateShort(iso);
}
function isSameDay(a: string, b: string) {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear()===y.getFullYear() && x.getMonth()===y.getMonth() && x.getDate()===y.getDate();
}
function pickNextDayType(history: Session[]): DayType {
  const recent = history.slice(0,4).map(h=>h.dayType);
  const order: DayType[] = ['Chest & Triceps','Back & Biceps','Legs','Arms'];
  for (const dt of order) { if (!recent.includes(dt)) return dt; }
  const last = history[0]?.dayType;
  return last ? order[(order.indexOf(last)+1)%order.length] : 'Chest & Triceps';
}

// ============================================================================
// WORKOUT TEMPLATES & WEIGHT COMPUTATION
// ============================================================================

function baseWorkoutTemplate(dayType: DayType): Exercise[] {
  if (dayType === 'Chest & Triceps') return [
    { id:uid('ex'), name:'Barbell Bench Press', primary:'bench', muscleGroups:['Chest','Triceps','Shoulders'], sets:4, reps:'6-10' },
    { id:uid('ex'), name:'Incline Dumbbell Press', primary:'accessory', muscleGroups:['Chest'], sets:3, reps:'8-12' },
    { id:uid('ex'), name:'Dips (Assisted if needed)', primary:'accessory', muscleGroups:['Chest','Triceps'], sets:3, reps:'6-12' },
    { id:uid('ex'), name:'Triceps Rope Pushdown', primary:'accessory', muscleGroups:['Triceps'], sets:3, reps:'10-15' },
    { id:uid('ex'), name:'Overhead Triceps Extension', primary:'accessory', muscleGroups:['Triceps'], sets:3, reps:'10-15' },
  ];
  if (dayType === 'Back & Biceps') return [
    { id:uid('ex'), name:'Barbell Row', primary:'row', muscleGroups:['Back','Biceps'], sets:4, reps:'6-10' },
    { id:uid('ex'), name:'Pull-Ups / Lat Pulldown', primary:'accessory', muscleGroups:['Back'], sets:3, reps:'6-12' },
    { id:uid('ex'), name:'Seated Cable Row', primary:'accessory', muscleGroups:['Back'], sets:3, reps:'8-12' },
    { id:uid('ex'), name:'Face Pulls', primary:'accessory', muscleGroups:['Rear Delts','Upper Back'], sets:3, reps:'12-15' },
    { id:uid('ex'), name:'Dumbbell Curls', primary:'accessory', muscleGroups:['Biceps'], sets:3, reps:'10-15' },
  ];
  if (dayType === 'Legs') return [
    { id:uid('ex'), name:'Back Squat', primary:'squat', muscleGroups:['Quads','Glutes'], sets:4, reps:'5-8' },
    { id:uid('ex'), name:'Romanian Deadlift', primary:'accessory', muscleGroups:['Hamstrings','Glutes'], sets:3, reps:'6-10' },
    { id:uid('ex'), name:'Leg Press', primary:'accessory', muscleGroups:['Quads'], sets:3, reps:'10-15' },
    { id:uid('ex'), name:'Hamstring Curl', primary:'accessory', muscleGroups:['Hamstrings'], sets:3, reps:'10-15' },
    { id:uid('ex'), name:'Calf Raises', primary:'accessory', muscleGroups:['Calves'], sets:3, reps:'12-20' },
  ];
  return [
    { id:uid('ex'), name:'Overhead Press', primary:'ohp', muscleGroups:['Shoulders','Triceps'], sets:4, reps:'6-10' },
    { id:uid('ex'), name:'Lateral Raises', primary:'accessory', muscleGroups:['Shoulders'], sets:3, reps:'12-15' },
    { id:uid('ex'), name:'Incline Dumbbell Curls', primary:'accessory', muscleGroups:['Biceps'], sets:3, reps:'10-15' },
    { id:uid('ex'), name:'Skull Crushers', primary:'accessory', muscleGroups:['Triceps'], sets:3, reps:'8-12' },
    { id:uid('ex'), name:'Hammer Curls', primary:'accessory', muscleGroups:['Biceps','Forearms'], sets:3, reps:'10-15' },
  ];
}

function findLastLiftPerformance(history: Session[], lift: LiftKey) {
  for (const s of history) for (const ex of s.workout) {
    if (ex.primary === lift && ex.targetWeightLb) {
      return { session: s, exercise: ex, log: s.logs.find(l => l.exerciseId === ex.id) };
    }
  }
  return null;
}

function computeTargetWeightLb(args: { setup:Setup; history:Session[]; lift:LiftKey; dayType:DayType; currentEnergy?:number; currentSleep?:number }) {
  const { setup, history, lift, currentEnergy=3, currentSleep } = args;
  const oneRM = estimate1RMFrom5RM(setup.fiveRM[lift]||0);
  const tMax = trainingMax(oneRM);
  const basePct = setup.goal==='Strength'?0.8:setup.goal==='Health'?0.65:0.7;
  let target = tMax * basePct;
  let mod = 0;
  if (currentEnergy<=2) mod -= 5; else if (currentEnergy>=4) mod += 5;
  if (currentSleep !== undefined) { if (currentSleep<6) mod -= 2.5; else if (currentSleep>=8) mod += 2.5; }
  const last = findLastLiftPerformance(history, lift);
  if (last?.exercise?.targetWeightLb) {
    const lw = last.exercise.targetWeightLb, ld = last.session.difficulty, le = last.session.energy;
    let bump = 0;
    if (ld<=2 && le>=4) bump=5; else if (ld===3) bump=2.5; else if (ld>=4||le<=2) bump=-5;
    target = lw + bump;
  }
  target += mod;
  return roundTo2_5(clamp(target, tMax*0.55, tMax*0.9));
}

function findLastAccessoryPerformance(history: Session[], name: string) {
  for (const s of history) for (const ex of s.workout) {
    if (ex.name === name && ex.targetWeightLb) {
      return { session: s, exercise: ex, log: s.logs.find(l => l.exerciseId === ex.id) };
    }
  }
  return null;
}

const ACCESSORY_DEFAULTS: Record<string, { relativeTo:LiftKey; ratio:number; minWeight:number; isPerDumbbell?:boolean }> = {
  'Incline Dumbbell Press':{relativeTo:'bench',ratio:0.35,minWeight:20,isPerDumbbell:true},
  'Dips (Assisted if needed)':{relativeTo:'bench',ratio:0,minWeight:0},
  'Triceps Rope Pushdown':{relativeTo:'bench',ratio:0.25,minWeight:20},
  'Overhead Triceps Extension':{relativeTo:'bench',ratio:0.20,minWeight:15},
  'Pull-Ups / Lat Pulldown':{relativeTo:'row',ratio:0.65,minWeight:60},
  'Seated Cable Row':{relativeTo:'row',ratio:0.55,minWeight:50},
  'Face Pulls':{relativeTo:'row',ratio:0.25,minWeight:20},
  'Dumbbell Curls':{relativeTo:'row',ratio:0.15,minWeight:15,isPerDumbbell:true},
  'Romanian Deadlift':{relativeTo:'deadlift',ratio:0.50,minWeight:95},
  'Leg Press':{relativeTo:'squat',ratio:1.2,minWeight:90},
  'Hamstring Curl':{relativeTo:'squat',ratio:0.25,minWeight:40},
  'Calf Raises':{relativeTo:'squat',ratio:0.40,minWeight:50},
  'Lateral Raises':{relativeTo:'ohp',ratio:0.15,minWeight:10,isPerDumbbell:true},
  'Incline Dumbbell Curls':{relativeTo:'row',ratio:0.12,minWeight:12,isPerDumbbell:true},
  'Skull Crushers':{relativeTo:'bench',ratio:0.30,minWeight:30},
  'Hammer Curls':{relativeTo:'row',ratio:0.15,minWeight:15,isPerDumbbell:true},
};

function computeAccessoryWeightLb(args:{setup:Setup;history:Session[];exerciseName:string;currentEnergy?:number;currentSleep?:number}): number|undefined {
  const { setup, history, exerciseName, currentEnergy=3, currentSleep } = args;
  const cfg = ACCESSORY_DEFAULTS[exerciseName];
  if (cfg && cfg.ratio===0) return undefined;
  let mod = 0;
  if (currentEnergy<=2) mod -= 2.5; else if (currentEnergy>=4) mod += 2.5;
  if (currentSleep !== undefined) { if (currentSleep<6) mod -= 2.5; else if (currentSleep>=8) mod += 2.5; }
  const last = findLastAccessoryPerformance(history, exerciseName);
  if (last?.exercise?.targetWeightLb) {
    const lw=last.exercise.targetWeightLb, ld=last.session.difficulty, le=last.session.energy;
    let bump=0;
    if (ld<=2&&le>=4) bump=2.5; else if (ld===3) bump=0; else if (ld>=4||le<=2) bump=-2.5;
    return roundTo2_5(Math.max(lw+bump+mod, cfg?.minWeight||10));
  }
  if (cfg) {
    const pw = setup.fiveRM[cfg.relativeTo]||0;
    if (pw===0) return undefined;
    let bw = pw * cfg.ratio;
    if (setup.goal==='Strength') bw*=1.1; else if (setup.goal==='Health') bw*=0.85;
    return roundTo2_5(Math.max(bw+mod, cfg.minWeight));
  }
  return undefined;
}

// ============================================================================
// ANALYTICS
// ============================================================================

function calculateSessionVolume(session: Session): number {
  return session.workout.reduce((t,ex) => {
    const w=ex.targetWeightLb||0, s=ex.sets;
    const m=ex.reps.match(/(\d+)(?:-(\d+))?/);
    const r=m?m[2]?(parseInt(m[1])+parseInt(m[2]))/2:parseInt(m[1]):0;
    return t+(s*r*w);
  }, 0);
}

function calculateMuscleGroupVolume(history: Session[], days=7): Record<string, number> {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-days);
  const v: Record<string, number> = {};
  history.filter(s=>new Date(s.dateISO)>=cutoff).forEach(session => {
    session.workout.forEach(ex => {
      const w=ex.targetWeightLb||50, s=ex.sets;
      const m=ex.reps.match(/(\d+)(?:-(\d+))?/);
      const r=m?m[2]?(parseInt(m[1])+parseInt(m[2]))/2:parseInt(m[1]):8;
      const vol=s*r*w;
      ex.muscleGroups.forEach(mg => { v[mg]=(v[mg]||0)+vol; });
    });
  });
  return v;
}

function findPersonalRecords(history: Session[]): Record<LiftKey, {weight:number;date:string}|null> {
  const prs: Record<LiftKey, {weight:number;date:string}|null> = {bench:null,squat:null,deadlift:null,ohp:null,row:null};
  history.forEach(s => s.workout.forEach(ex => {
    if (ex.primary!=='accessory' && ex.targetWeightLb) {
      const l=ex.primary as LiftKey;
      if (!prs[l]||ex.targetWeightLb>prs[l]!.weight) prs[l]={weight:ex.targetWeightLb,date:s.dateISO};
    }
  }));
  return prs;
}

function calculateStreakStats(history: Session[]) {
  if (!history.length) return {currentStreak:0,longestStreak:0,workoutsThisWeek:0,workoutsThisMonth:0,avgWorkoutsPerWeek:0,totalWorkouts:0};
  const now=new Date();
  const wk=history.filter(s=>new Date(s.dateISO)>=new Date(now.getTime()-7*86400000)).length;
  const mo=history.filter(s=>new Date(s.dateISO)>=new Date(now.getTime()-30*86400000)).length;
  const dates=history.map(s=>new Date(s.dateISO)).sort((a,b)=>b.getTime()-a.getTime());
  let cs=0, cd=new Date(); cd.setHours(0,0,0,0);
  for (const wd of dates) { const d=new Date(wd); d.setHours(0,0,0,0); if(getDaysBetween(cd,d)<=3){cs++;cd=d;}else break; }
  let ls=0,ts=1;
  for(let i=1;i<dates.length;i++){if(getDaysBetween(dates[i-1],dates[i])<=3)ts++;else{ls=Math.max(ls,ts);ts=1;}}
  ls=Math.max(ls,ts);
  let avg=history.length;
  if(history.length>=2){const wb=Math.max(1,getDaysBetween(dates[dates.length-1],dates[0])/7);avg=Math.round((history.length/wb)*10)/10;}
  return {currentStreak:cs,longestStreak:ls,workoutsThisWeek:wk,workoutsThisMonth:mo,avgWorkoutsPerWeek:avg,totalWorkouts:history.length};
}

function calculateVolumeTrends(history: Session[], weeks=8) {
  const wd: Record<string,{volume:number;workouts:number}> = {};
  history.forEach(s=>{const wk=getWeekNumber(new Date(s.dateISO));if(!wd[wk])wd[wk]={volume:0,workouts:0};wd[wk].volume+=calculateSessionVolume(s);wd[wk].workouts+=1;});
  return Object.entries(wd).map(([w,d])=>({week:w,...d})).sort((a,b)=>{
    const p=(w:string)=>{const m=w.match(/W(\d+)\s+(\d+)/);return m?parseInt(m[2])*100+parseInt(m[1]):0;};
    return p(a.week)-p(b.week);
  }).slice(-weeks);
}

function extractProgressData(history: Session[], selectedLift: LiftKey|'all') {
  const data: Array<{date:string;dateISO:string;lift:LiftKey;liftName:string;weight:number;energy:number}> = [];
  history.forEach(s=>s.workout.forEach(ex=>{
    if(ex.primary!=='accessory'&&ex.targetWeightLb){
      const l=ex.primary as LiftKey;
      if(selectedLift==='all'||l===selectedLift) data.push({date:formatDateShort(s.dateISO),dateISO:s.dateISO,lift:l,liftName:ex.name,weight:ex.targetWeightLb,energy:s.energy});
    }
  }));
  return data.sort((a,b)=>new Date(a.dateISO).getTime()-new Date(b.dateISO).getTime());
}

// ============================================================================
// STORAGE
// ============================================================================

function createDefaultProfile(name: string): UserProfile {
  return { id:uid('profile'), displayName:name, avatarColor:AVATAR_COLORS[Math.floor(Math.random()*AVATAR_COLORS.length)],
    createdAt:new Date().toISOString(), lastActiveAt:new Date().toISOString(), setup:null, history:[],
    preferences:{theme:'dark',units:'imperial'} };
}

function loadAppState(): AppState {
  if(typeof window==='undefined') return {profiles:[],activeProfileId:null};
  const raw=window.localStorage.getItem(LS_KEY);
  if(raw){try{const p=JSON.parse(raw);return{profiles:Array.isArray(p.profiles)?p.profiles:[],activeProfileId:p.activeProfileId??null};}catch{}}
  const old=window.localStorage.getItem(OLD_LS_KEY);
  if(old){try{const d=JSON.parse(old);const mp:UserProfile={id:uid('profile'),displayName:d.setup?.name||'Migrated User',avatarColor:AVATAR_COLORS[0],createdAt:new Date().toISOString(),lastActiveAt:new Date().toISOString(),setup:d.setup??null,history:Array.isArray(d.history)?d.history:[],preferences:{theme:'dark',units:'imperial'}};const ns={profiles:[mp],activeProfileId:mp.id};saveAppState(ns);window.localStorage.removeItem(OLD_LS_KEY);return ns;}catch{}}
  return {profiles:[],activeProfileId:null};
}

function safeJson(obj: unknown) {
  const seen = new WeakSet<object>();
  return JSON.stringify(obj, (_k, v) => {
    if(typeof window!=='undefined'&&v===window) return undefined;
    if(typeof document!=='undefined'&&v===document) return undefined;
    if(typeof v==='object'&&v!==null){if(seen.has(v))return undefined;seen.add(v);}
    if(typeof v==='function') return undefined;
    return v;
  });
}

function saveAppState(state: AppState) { if(typeof window==='undefined')return; window.localStorage.setItem(LS_KEY, safeJson(state)); }

// ============================================================================
// DEMO DATA
// ============================================================================

function generateDemoData(profileName: string): {setup:Setup;history:Session[]} {
  const demoSetup:Setup = {name:profileName,gender:'Male',heightIn:70,weightLb:180,goal:'Hypertrophy',fiveRM:{bench:225,squat:275,deadlift:315,ohp:135,row:185}};
  const demoHistory: Session[] = [];
  const order:DayType[] = ['Chest & Triceps','Back & Biceps','Legs','Arms'];
  const sw:Record<LiftKey,number> = {bench:155,squat:185,deadlift:225,ohp:85,row:135};
  const tg:Record<LiftKey,number> = {bench:12.5,squat:15,deadlift:15,ohp:7.5,row:10};
  const days:number[] = []; let d=1;
  while(d<=56){days.push(d);d+=Math.random()<0.15?3:Math.random()<0.5?2:1;}
  days.forEach((da,wi) => {
    const dt=order[wi%4], prog=da/56;
    const en=Math.random()<0.1?2:Math.random()<0.3?3:Math.random()<0.7?4:5;
    const sl=Math.floor(Math.random()*4)+5;
    const di=en<=2?4:en>=4?3:Math.floor(Math.random()*2)+3;
    const gw=(l:LiftKey)=>roundTo2_5(sw[l]+tg[l]*(1-prog)+(Math.random()-0.5)*5+(en<=2?-5:en>=5?2.5:0));
    let wo:Exercise[]=[],mg:string[]=[];
    if(dt==='Chest & Triceps'){wo=[{id:uid('ex'),name:'Barbell Bench Press',primary:'bench',muscleGroups:['Chest','Triceps','Shoulders'],sets:4,reps:'6-10',targetWeightLb:gw('bench')},{id:uid('ex'),name:'Incline Dumbbell Press',primary:'accessory',muscleGroups:['Chest'],sets:3,reps:'8-12'},{id:uid('ex'),name:'Dips (Assisted if needed)',primary:'accessory',muscleGroups:['Chest','Triceps'],sets:3,reps:'6-12'},{id:uid('ex'),name:'Triceps Rope Pushdown',primary:'accessory',muscleGroups:['Triceps'],sets:3,reps:'10-15'},{id:uid('ex'),name:'Overhead Triceps Extension',primary:'accessory',muscleGroups:['Triceps'],sets:3,reps:'10-15'}];mg=['Chest','Triceps','Shoulders'];}
    else if(dt==='Back & Biceps'){wo=[{id:uid('ex'),name:'Barbell Row',primary:'row',muscleGroups:['Back','Biceps'],sets:4,reps:'6-10',targetWeightLb:gw('row')},{id:uid('ex'),name:'Pull-Ups / Lat Pulldown',primary:'accessory',muscleGroups:['Back'],sets:3,reps:'6-12'},{id:uid('ex'),name:'Seated Cable Row',primary:'accessory',muscleGroups:['Back'],sets:3,reps:'8-12'},{id:uid('ex'),name:'Face Pulls',primary:'accessory',muscleGroups:['Rear Delts','Upper Back'],sets:3,reps:'12-15'},{id:uid('ex'),name:'Dumbbell Curls',primary:'accessory',muscleGroups:['Biceps'],sets:3,reps:'10-15'}];mg=['Back','Biceps'];}
    else if(dt==='Legs'){wo=[{id:uid('ex'),name:'Back Squat',primary:'squat',muscleGroups:['Quads','Glutes'],sets:4,reps:'5-8',targetWeightLb:gw('squat')},{id:uid('ex'),name:'Romanian Deadlift',primary:'deadlift',muscleGroups:['Hamstrings','Glutes'],sets:3,reps:'6-10',targetWeightLb:gw('deadlift')},{id:uid('ex'),name:'Leg Press',primary:'accessory',muscleGroups:['Quads'],sets:3,reps:'10-15'},{id:uid('ex'),name:'Hamstring Curl',primary:'accessory',muscleGroups:['Hamstrings'],sets:3,reps:'10-15'},{id:uid('ex'),name:'Calf Raises',primary:'accessory',muscleGroups:['Calves'],sets:3,reps:'12-20'}];mg=['Quads','Glutes','Hamstrings'];}
    else{wo=[{id:uid('ex'),name:'Overhead Press',primary:'ohp',muscleGroups:['Shoulders','Triceps'],sets:4,reps:'6-10',targetWeightLb:gw('ohp')},{id:uid('ex'),name:'Lateral Raises',primary:'accessory',muscleGroups:['Shoulders'],sets:3,reps:'12-15'},{id:uid('ex'),name:'Incline Dumbbell Curls',primary:'accessory',muscleGroups:['Biceps'],sets:3,reps:'10-15'},{id:uid('ex'),name:'Skull Crushers',primary:'accessory',muscleGroups:['Triceps'],sets:3,reps:'8-12'},{id:uid('ex'),name:'Hammer Curls',primary:'accessory',muscleGroups:['Biceps','Forearms'],sets:3,reps:'10-15'}];mg=['Shoulders','Biceps','Triceps'];}
    demoHistory.push({id:uid('sess'),dateISO:new Date(Date.now()-da*86400000).toISOString(),dayType:dt,muscleGroups:mg,energy:en,difficulty:di,sleepHours:sl,workout:wo,logs:wo.map(w=>({exerciseId:w.id}))});
  });
  return {setup:demoSetup,history:demoHistory};
}

// ============================================================================
// MAIN APP COMPONENT
// ============================================================================

export default function Page() {
  const [appState, setAppState] = useState<AppState>({profiles:[],activeProfileId:null});
  const [activeTab, setActiveTab] = useState<'today'|'progress'|'profile'>('today');
  const [showProfileSelector, setShowProfileSelector] = useState(false);
  const [showCheckin, setShowCheckin] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => { const s=loadAppState(); setAppState(s); setIsLoaded(true); if(!s.activeProfileId||!s.profiles.length) setShowProfileSelector(true); }, []);
  useEffect(() => { if(isLoaded) saveAppState(appState); }, [appState, isLoaded]);

  const activeProfile = useMemo(()=>appState.profiles.find(p=>p.id===appState.activeProfileId)??null, [appState.profiles, appState.activeProfileId]);
  const setup = activeProfile?.setup ?? null;
  const history = activeProfile?.history ?? [];
  const nextDayType = useMemo(()=>pickNextDayType(history), [history]);
  const today = history[0] && isSameDay(history[0].dateISO, new Date().toISOString()) ? history[0] : null;
  const restTimerPrefs = useMemo(() => activeProfile?.restTimerPrefs ?? DEFAULT_REST_PREFS, [activeProfile]);
  const updateRestTimerPrefs = useCallback((prefs: RestTimerPreferences) => {
    updateActiveProfile({ restTimerPrefs: prefs });
  }, [updateActiveProfile]);

  const createProfile = useCallback((name:string)=>{
    const p=createDefaultProfile(name);
    setAppState(prev=>({profiles:[...prev.profiles,p],activeProfileId:p.id}));
    setShowProfileSelector(false); setActiveTab('profile');
  },[]);
  const switchProfile = useCallback((id:string)=>{
    setAppState(prev=>({...prev,activeProfileId:id,profiles:prev.profiles.map(p=>p.id===id?{...p,lastActiveAt:new Date().toISOString()}:p)}));
    setShowProfileSelector(false);
  },[]);
  const deleteProfile = useCallback((id:string)=>{
    setAppState(prev=>{const np=prev.profiles.filter(p=>p.id!==id);return{profiles:np,activeProfileId:prev.activeProfileId===id?(np[0]?.id??null):prev.activeProfileId};});
  },[]);
  const updateActiveProfile = useCallback((updates:Partial<UserProfile>)=>{
    if(!appState.activeProfileId) return;
    setAppState(prev=>({...prev,profiles:prev.profiles.map(p=>p.id===prev.activeProfileId?{...p,...updates,lastActiveAt:new Date().toISOString()}:p)}));
  },[appState.activeProfileId]);

  const [draftSetup, setDraftSetup] = useState<Setup>({name:'',gender:'Male',heightIn:70,weightLb:180,goal:'Hypertrophy',fiveRM:{bench:135,squat:185,deadlift:225,ohp:95,row:135}});
  useEffect(()=>{ if(setup) setDraftSetup(setup); else if(activeProfile) setDraftSetup(prev=>({...prev,name:activeProfile.displayName})); },[setup, activeProfile]);

  function generateTodayWorkout(energy=3, sleepHours?:number) {
    if(!setup||!activeProfile) return;
    const dt=nextDayType, tmpl=baseWorkoutTemplate(dt);
    const wo=tmpl.map(ex=>{
      if(ex.primary!=='accessory') return {...ex,targetWeightLb:computeTargetWeightLb({setup,history,lift:ex.primary as LiftKey,dayType:dt,currentEnergy:energy,currentSleep:sleepHours})};
      const aw=computeAccessoryWeightLb({setup,history,exerciseName:ex.name,currentEnergy:energy,currentSleep:sleepHours});
      return aw!==undefined?{...ex,targetWeightLb:aw}:ex;
    });
    const mg=Array.from(new Set(wo.flatMap(w=>w.muscleGroups)));
    const sess:Session={id:uid('sess'),dateISO:new Date().toISOString(),dayType:dt,muscleGroups:mg,energy,difficulty:3,sleepHours,workout:wo,logs:wo.map(w=>({exerciseId:w.id})),completed:false};
    const fh=history[0]&&isSameDay(history[0].dateISO,new Date().toISOString())?history.slice(1):history;
    updateActiveProfile({history:[sess,...fh]}); setActiveTab('today');
  }

  // Auto show checkin if no workout today
  useEffect(()=>{if(isLoaded&&setup&&!today&&activeProfile&&!showProfileSelector) setShowCheckin(true);},[isLoaded,setup,today,activeProfile,showProfileSelector]);

  function updateToday(patch:Partial<Session>){if(!today||!activeProfile)return;updateActiveProfile({history:[{...today,...patch},...history.slice(1)]});}
  function regenerateWorkoutWeights(en:number,di:number,sl?:number){
    if(!today||!setup) return;
    const uw=today.workout.map(ex=>{
      if(ex.primary!=='accessory') return{...ex,targetWeightLb:computeTargetWeightLb({setup,history:history.slice(1),lift:ex.primary as LiftKey,dayType:today.dayType,currentEnergy:en,currentSleep:sl})};
      const aw=computeAccessoryWeightLb({setup,history:history.slice(1),exerciseName:ex.name,currentEnergy:en,currentSleep:sl});
      return aw!==undefined?{...ex,targetWeightLb:aw}:ex;
    });
    updateToday({workout:uw,energy:en,difficulty:di,sleepHours:sl});
  }
  function updateExerciseLog(exId:string,patch:Partial<ExerciseLog>){if(!today)return;updateToday({logs:today.logs.map(l=>l.exerciseId===exId?{...l,...patch}:l)});}

  function applyDemoData(){if(!activeProfile)return;const{setup:ds,history:dh}=generateDemoData(activeProfile.displayName);updateActiveProfile({setup:ds,history:dh});setActiveTab('progress');}
  function resetAll(){if(typeof window!=='undefined'){window.localStorage.removeItem(LS_KEY);window.localStorage.removeItem(OLD_LS_KEY);}setAppState({profiles:[],activeProfileId:null});setShowProfileSelector(true);}
  function exportProfileData(){
    if(!activeProfile) return;
    const blob=new Blob([JSON.stringify({exportVersion:'1.0',exportDate:new Date().toISOString(),appName:'FLEX',profile:{displayName:activeProfile.displayName,setup:activeProfile.setup,history:activeProfile.history,preferences:activeProfile.preferences}},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`flex-${activeProfile.displayName.toLowerCase().replace(/\s+/g,'-')}-${new Date().toISOString().split('T')[0]}.json`;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  }
  function handleImportData(event:React.ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=(e)=>{try{const d=JSON.parse(e.target?.result as string);if(d.appName!=='FLEX'&&!d.setup&&!d.history){alert('Invalid file.');return;}
      let np:UserProfile;
      if(d.profile){const p=d.profile;np={id:uid('profile'),displayName:p.displayName||'Imported',avatarColor:AVATAR_COLORS[Math.floor(Math.random()*AVATAR_COLORS.length)],createdAt:new Date().toISOString(),lastActiveAt:new Date().toISOString(),setup:p.setup||null,history:Array.isArray(p.history)?p.history:[],preferences:p.preferences||{theme:'dark',units:'imperial'}};}
      else{np={id:uid('profile'),displayName:d.setup?.name||'Imported',avatarColor:AVATAR_COLORS[Math.floor(Math.random()*AVATAR_COLORS.length)],createdAt:new Date().toISOString(),lastActiveAt:new Date().toISOString(),setup:d.setup||null,history:Array.isArray(d.history)?d.history:[],preferences:{theme:'dark',units:'imperial'}};}
      setAppState(prev=>({profiles:[...prev.profiles,np],activeProfileId:np.id}));
    }catch{alert('Import failed.');}event.target.value='';};
    reader.readAsText(file);
  }

  // ============================================================================
  // RENDER
  // ============================================================================

  if (!isLoaded) return (
    <div className="min-h-dvh bg-surface-base flex items-center justify-center">
      <div className="text-center animate-fade-in">
        <div className="text-hero text-gradient mb-2">FLEX</div>
        <div className="text-caption text-white/40">Loading...</div>
      </div>
    </div>
  );

  if (showProfileSelector) return <ProfileSelector profiles={appState.profiles} onSelect={switchProfile} onCreate={createProfile} onDelete={deleteProfile} />;

  return (
    <div className="min-h-dvh bg-surface-base text-white font-body safe-bottom">
      {showCheckin && <CheckinOverlay onStart={(en,sl)=>{generateTodayWorkout(en,sl);setShowCheckin(false);}} onSkip={()=>{generateTodayWorkout(3);setShowCheckin(false);}} />}
      <header className="sticky top-0 z-40 bg-surface-base/90 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-extrabold tracking-tight text-gradient">FLEX</h1>
          <button onClick={()=>setShowProfileSelector(true)} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-black" style={{background:activeProfile?.avatarColor||'#64c8ff'}}>{activeProfile?.displayName?.charAt(0).toUpperCase()||'?'}</div>
            <span className="text-caption text-white/70 hidden sm:block">{activeProfile?.displayName}</span>
          </button>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6 pb-24">
        {activeTab==='today' && <TodayView today={today} nextDayType={nextDayType} history={history} setup={setup} onGenerate={()=>setShowCheckin(true)} onUpdateLog={updateExerciseLog} onRegenerateWeights={regenerateWorkoutWeights} onMarkComplete={(c)=>updateToday({completed:c})} restTimerPrefs={restTimerPrefs} />}
        {activeTab==='progress' && <ProgressView history={history} />}
        {activeTab==='profile' && <ProfileView profile={activeProfile} draftSetup={draftSetup} setDraftSetup={setDraftSetup} onSaveSetup={()=>updateActiveProfile({setup:draftSetup,displayName:draftSetup.name||activeProfile?.displayName||'User'})} onLoadDemo={applyDemoData} onExport={exportProfileData} onImport={handleImportData} onReset={resetAll} restTimerPrefs={restTimerPrefs} onUpdateRestPrefs={updateRestTimerPrefs} />}
      </main>
      <nav className="bottom-nav">
        {([{key:'today' as const,icon:'🏋️',label:'Train'},{key:'progress' as const,icon:'📊',label:'Progress'},{key:'profile' as const,icon:'👤',label:'Profile'}]).map(item=>(
          <button key={item.key} onClick={()=>setActiveTab(item.key)} className={`bottom-nav-item ${activeTab===item.key?'active':''}`}>
            <span className="text-xl">{item.icon}</span>
            <span className="text-[11px] font-semibold">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ============================================================================
// PROFILE SELECTOR
// ============================================================================

function ProfileSelector({profiles,onSelect,onCreate,onDelete}:{profiles:UserProfile[];onSelect:(id:string)=>void;onCreate:(name:string)=>void;onDelete:(id:string)=>void}) {
  const [isCreating, setIsCreating] = useState(profiles.length===0);
  const [newName, setNewName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string|null>(null);
  return (
    <div className="min-h-dvh bg-surface-base flex items-center justify-center p-6 font-body">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-10">
          <h1 className="text-hero text-gradient mb-2">FLEX</h1>
          <p className="text-body text-white/40">{profiles.length===0?'Create your profile to get started':"Who's training today?"}</p>
        </div>
        {profiles.length>0 && !isCreating && (
          <div className="flex flex-col gap-3 mb-6 stagger-children">
            {profiles.map(profile=>(
              <div key={profile.id} onClick={()=>deleteConfirm!==profile.id&&onSelect(profile.id)} className="flex items-center gap-4 p-4 card cursor-pointer hover:bg-white/[0.06] hover:border-white/[0.15] transition-all active:scale-[0.98]">
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-black shrink-0" style={{background:profile.avatarColor}}>{profile.displayName.charAt(0).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-subheading text-white truncate">{profile.displayName}</div>
                  <div className="text-caption text-white/40">{profile.history.length} workouts · {getRelativeTime(profile.lastActiveAt)}</div>
                </div>
                {deleteConfirm===profile.id?(
                  <div className="flex gap-2" onClick={e=>e.stopPropagation()}>
                    <button onClick={()=>onDelete(profile.id)} className="px-3 py-1.5 text-xs font-bold bg-danger/20 border border-danger/30 rounded-lg text-danger">Delete</button>
                    <button onClick={()=>setDeleteConfirm(null)} className="px-3 py-1.5 text-xs font-bold bg-white/5 border border-white/10 rounded-lg text-white">Cancel</button>
                  </div>
                ):(
                  <button onClick={e=>{e.stopPropagation();setDeleteConfirm(profile.id);}} className="w-8 h-8 flex items-center justify-center text-white/20 hover:text-danger transition-colors text-lg">×</button>
                )}
              </div>
            ))}
          </div>
        )}
        {isCreating?(
          <div className="animate-slide-up">
            <label className="field-label">Your Name</label>
            <input type="text" value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&newName.trim()&&onCreate(newName.trim())} placeholder="Enter your name" autoFocus className="input-dark mb-4" />
            <div className="flex gap-3">
              <button onClick={()=>newName.trim()&&onCreate(newName.trim())} disabled={!newName.trim()} className={`btn-primary flex-1 ${!newName.trim()?'opacity-40 cursor-not-allowed':''}`}>Create Profile</button>
              {profiles.length>0 && <button onClick={()=>setIsCreating(false)} className="btn-secondary">Cancel</button>}
            </div>
          </div>
        ):(
          <button onClick={()=>setIsCreating(true)} className="btn-secondary w-full flex items-center justify-center gap-2"><span className="text-lg">+</span> New Profile</button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// CHECK-IN OVERLAY
// ============================================================================

function CheckinOverlay({onStart,onSkip}:{onStart:(energy:number,sleep?:number)=>void;onSkip:()=>void}) {
  const [energy, setEnergy] = useState<number|null>(null);
  const [sleep, setSleep] = useState<number|null>(null);
  return (
    <div className="fixed inset-0 z-50 bg-surface-base/95 backdrop-blur-2xl flex items-center justify-center p-6 animate-fade-in">
      <div className="w-full max-w-sm text-center">
        <div className="text-4xl mb-4">⚡</div>
        <h2 className="text-display text-white mb-2">How are you feeling?</h2>
        <p className="text-body text-white/40 mb-8">This adjusts your workout weights</p>
        <div className="mb-8">
          <div className="field-label text-center mb-4">Energy Level</div>
          <div className="flex justify-center gap-2">
            {ENERGY_EMOJIS.map((emoji,i)=>(
              <button key={i} onClick={()=>setEnergy(i)} className={`w-12 h-12 rounded-xl text-2xl flex items-center justify-center transition-all duration-200 ${energy===i?'bg-accent/20 border-2 border-accent scale-110':'bg-white/5 border border-white/10 hover:bg-white/10'}`}>{emoji}</button>
            ))}
          </div>
        </div>
        <div className="mb-10">
          <div className="field-label text-center mb-4">Sleep Last Night</div>
          <div className="flex justify-center gap-2 flex-wrap">
            {SLEEP_OPTIONS.map((label,i)=>(
              <button key={i} onClick={()=>setSleep(i)} className={`px-4 py-2.5 rounded-xl text-caption font-semibold transition-all duration-200 ${sleep===i?'bg-accent/20 border border-accent text-accent':'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10'}`}>{label}</button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <button onClick={()=>onStart(energy??3,sleep!==null?SLEEP_VALUES[sleep]:undefined)} className="btn-primary w-full text-base">{energy!==null?"Let's Go":'Start Workout'}</button>
          <button onClick={onSkip} className="text-caption text-white/30 hover:text-white/50 transition-colors py-2">Skip check-in</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// REST TIMER
// ============================================================================

function RestTimer({ duration, exerciseName, onComplete, onSkip }: {
  duration: number;
  exerciseName: string;
  onComplete: () => void;
  onSkip: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(duration);
  const [isPaused, setIsPaused] = useState(false);
  const [totalDuration, setTotalDuration] = useState(duration);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const hasVibratedRef = useRef(false);

  // Wake Lock — keep screen on
  useEffect(() => {
    async function requestWakeLock() {
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
        }
      } catch { /* silently fail */ }
    }
    requestWakeLock();
    return () => { wakeLockRef.current?.release(); };
  }, []);

  // Countdown
  useEffect(() => {
    if (isPaused || secondsLeft <= 0) return;
    const id = setTimeout(() => setSecondsLeft(s => s - 1), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft, isPaused]);

  // Timer complete
  useEffect(() => {
    if (secondsLeft <= 0 && !hasVibratedRef.current) {
      hasVibratedRef.current = true;
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      // Auto-advance after a brief moment
      const t = setTimeout(onComplete, 800);
      return () => clearTimeout(t);
    }
  }, [secondsLeft, onComplete]);

  const progress = totalDuration > 0 ? (totalDuration - secondsLeft) / totalDuration : 1;
  const minutes = Math.floor(Math.max(0, secondsLeft) / 60);
  const secs = Math.max(0, secondsLeft) % 60;
  const isFinished = secondsLeft <= 0;

  // Circular progress
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);

  function addTime(s: number) {
    setSecondsLeft(prev => prev + s);
    setTotalDuration(prev => prev + s);
  }

  return (
    <div className="fixed inset-0 z-50 bg-surface-base/98 backdrop-blur-2xl flex items-center justify-center p-6 animate-fade-in">
      <div className="w-full max-w-sm text-center">
        {/* Exercise context */}
        <div className="text-caption text-white/40 mb-2">Rest before next set</div>
        <div className="text-subheading text-white/70 mb-8 truncate px-4">{exerciseName}</div>

        {/* Circular timer */}
        <div className="relative w-52 h-52 mx-auto mb-8">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 200 200">
            {/* Track */}
            <circle cx="100" cy="100" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
            {/* Progress */}
            <circle
              cx="100" cy="100" r={radius} fill="none"
              stroke={isFinished ? '#4ade80' : '#64c8ff'}
              strokeWidth="8" strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-1000 ease-linear"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {isFinished ? (
              <div className="text-4xl animate-pulse">✓</div>
            ) : (
              <>
                <div className="text-hero text-white leading-none tabular-nums">
                  {minutes}:{String(secs).padStart(2, '0')}
                </div>
                <button
                  onClick={() => setIsPaused(!isPaused)}
                  className="text-caption text-white/40 hover:text-white/70 transition-colors mt-2"
                >
                  {isPaused ? '▶ Resume' : '❚❚ Pause'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Quick adjust buttons */}
        {!isFinished && (
          <div className="flex justify-center gap-3 mb-8">
            <button
              onClick={() => addTime(-15)}
              disabled={secondsLeft <= 15}
              className="px-4 py-2.5 rounded-xl text-caption font-semibold bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              −15s
            </button>
            <button
              onClick={() => addTime(15)}
              className="px-4 py-2.5 rounded-xl text-caption font-semibold bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 transition-all"
            >
              +15s
            </button>
            <button
              onClick={() => addTime(30)}
              className="px-4 py-2.5 rounded-xl text-caption font-semibold bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 transition-all"
            >
              +30s
            </button>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-3">
          {isFinished ? (
            <button onClick={onComplete} className="btn-success w-full text-base">
              Continue →
            </button>
          ) : (
            <button onClick={onSkip} className="text-caption text-white/30 hover:text-white/50 transition-colors py-3">
              Skip rest
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RestTimerSettings({ prefs, onChange }: {
  prefs: RestTimerPreferences;
  onChange: (p: RestTimerPreferences) => void;
}) {
  return (
    <div className="card p-5 mb-6">
      <h3 className="text-subheading text-white mb-4 flex items-center gap-2">⏱️ Rest Timer</h3>
      <div className="flex items-center justify-between mb-5">
        <span className="text-body text-white/70">Enable rest timer</span>
        <button
          onClick={() => onChange({ ...prefs, enabled: !prefs.enabled })}
          className={`w-12 h-7 rounded-full transition-all duration-200 relative ${prefs.enabled ? 'bg-accent' : 'bg-white/10'}`}
        >
          <div className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all duration-200 ${prefs.enabled ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>
      {prefs.enabled && (
        <div className="flex flex-col gap-4 animate-fade-in">
          {([
            { key: 'compoundSeconds' as const, label: 'Compound lifts', desc: 'Bench, Squat, Deadlift, OHP, Row' },
            { key: 'accessorySeconds' as const, label: 'Accessories', desc: 'Pull-ups, Dips, Cable rows, etc.' },
            { key: 'isolationSeconds' as const, label: 'Isolation', desc: 'Curls, Lateral raises, Pushdowns' },
          ]).map(({ key, label, desc }) => (
            <div key={key}>
              <div className="flex justify-between items-baseline mb-2">
                <div>
                  <div className="text-caption font-semibold text-white">{label}</div>
                  <div className="text-[10px] text-white/30">{desc}</div>
                </div>
                <span className="text-caption font-bold text-accent tabular-nums">
                  {Math.floor(prefs[key] / 60)}:{String(prefs[key] % 60).padStart(2, '0')}
                </span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {REST_PRESETS.map(p => (
                  <button
                    key={p.seconds}
                    onClick={() => onChange({ ...prefs, [key]: p.seconds })}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                      prefs[key] === p.seconds
                        ? 'bg-accent/20 text-accent border border-accent/30'
                        : 'bg-white/5 text-white/40 border border-transparent hover:bg-white/10'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
            <span className="text-caption text-white/50">Auto-start after logging</span>
            <button
              onClick={() => onChange({ ...prefs, autoStart: !prefs.autoStart })}
              className={`w-10 h-6 rounded-full transition-all duration-200 relative ${prefs.autoStart ? 'bg-accent' : 'bg-white/10'}`}
            >
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${prefs.autoStart ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TODAY VIEW
// ============================================================================

function TodayView({today,nextDayType,history,setup,onGenerate,onUpdateLog,onRegenerateWeights,onMarkComplete,restTimerPrefs}:{
  today:Session|null;nextDayType:DayType;history:Session[];setup:Setup|null;
  onGenerate:()=>void;onUpdateLog:(exId:string,patch:Partial<ExerciseLog>)=>void;
  onRegenerateWeights:(en:number,di:number,sl?:number)=>void;onMarkComplete:(c:boolean)=>void;
  restTimerPrefs:RestTimerPreferences;
}) {
  const [currentExIndex, setCurrentExIndex] = useState(0);
  const [showOverview, setShowOverview] = useState(true);
  const [showRestTimer, setShowRestTimer] = useState(false);
  const [restTimerDuration, setRestTimerDuration] = useState(90);
  const [pendingNextIndex, setPendingNextIndex] = useState<number | null>(null);
  const [pendingFinish, setPendingFinish] = useState(false);

  // Trigger rest timer before navigating to next exercise
  const handleNext = useCallback(() => {
    if (!today) return;
    const currentEx = today.workout[currentExIndex];
    if (restTimerPrefs.enabled && currentEx) {
      const dur = getRestDuration(currentEx, restTimerPrefs);
      setRestTimerDuration(dur);
      setPendingNextIndex(currentExIndex + 1);
      setShowRestTimer(true);
    } else {
      setCurrentExIndex(currentExIndex + 1);
    }
  }, [today, currentExIndex, restTimerPrefs]);

  const handleFinish = useCallback(() => {
    if (!today) return;
    onMarkComplete(true);
    setShowOverview(true);
  }, [today, onMarkComplete]);

  const handleRestComplete = useCallback(() => {
    setShowRestTimer(false);
    if (pendingFinish) {
      setPendingFinish(false);
      onMarkComplete(true);
      setShowOverview(true);
    } else if (pendingNextIndex !== null) {
      setCurrentExIndex(pendingNextIndex);
      setPendingNextIndex(null);
    }
  }, [pendingNextIndex, pendingFinish, onMarkComplete]);

  const handleRestSkip = useCallback(() => {
    setShowRestTimer(false);
    if (pendingFinish) {
      setPendingFinish(false);
      onMarkComplete(true);
      setShowOverview(true);
    } else if (pendingNextIndex !== null) {
      setCurrentExIndex(pendingNextIndex);
      setPendingNextIndex(null);
    }
  }, [pendingNextIndex, pendingFinish, onMarkComplete]);

  if (!today) return (
    <div className="text-center py-20 animate-fade-in">
      <div className="text-6xl mb-6">🏋️</div>
      <h2 className="text-display text-white mb-3">Ready to Train?</h2>
      <p className="text-body text-white/40 mb-8">{setup?`Next: ${nextDayType}`:'Set up your profile first.'}</p>
      <button onClick={onGenerate} disabled={!setup} className={setup?'btn-primary text-base px-10':'btn-secondary opacity-40 cursor-not-allowed px-10'}>{setup?'Start Workout':'Setup Profile First'}</button>
      {history.length>0&&history[0]&&(<div className="mt-8 card p-4 max-w-xs mx-auto"><div className="text-caption text-white/40 mb-1">Last workout</div><div className="text-subheading text-white">{history[0].dayType}</div><div className="text-caption text-white/30">{getRelativeTime(history[0].dateISO)}</div></div>)}
    </div>
  );

  const completionCount = today.logs.filter(l=>l.actualWeightLb!==undefined||l.actualReps!==undefined||l.rpe!==undefined).length;
  const progressPct = Math.round((completionCount/today.workout.length)*100);
  const currentEx = today.workout[currentExIndex];
  const currentLog = today.logs.find(l=>l.exerciseId===currentEx?.id);
  const isCompleted = today.completed||false;

  // REST TIMER OVERLAY
  if (showRestTimer) {
    const timerEx = today.workout[currentExIndex];
    return (
      <RestTimer
        duration={restTimerDuration}
        exerciseName={timerEx?.name || 'Next set'}
        onComplete={handleRestComplete}
        onSkip={handleRestSkip}
      />
    );
  }

  // OVERVIEW MODE
  if (showOverview) return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-display text-white">{today.dayType}</h2>
          {isCompleted && <span className="badge-success">Done</span>}
        </div>
        <p className="text-caption text-white/40">{today.muscleGroups.join(' · ')} · {today.workout.length} exercises</p>
      </div>
      <div className="mb-6">
        <div className="flex justify-between mb-2">
          <span className="text-caption text-white/40">Progress</span>
          <span className="text-caption font-bold" style={{color:progressPct===100?'#4ade80':'#64c8ff'}}>{completionCount}/{today.workout.length}</span>
        </div>
        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500 ease-out" style={{width:`${progressPct}%`,background:progressPct===100?'linear-gradient(90deg,#4ade80,#22c55e)':'linear-gradient(90deg,#64c8ff,#4da8ff)'}} />
        </div>
      </div>
      <details className="card mb-6 group">
        <summary className="p-4 cursor-pointer flex items-center justify-between text-caption text-white/50 hover:text-white/70 transition-colors list-none">
          <span>⚡ Energy {today.energy}/5 · Difficulty {today.difficulty}/5{today.sleepHours?` · Sleep ${today.sleepHours}h`:''}</span>
          <span className="group-open:rotate-180 transition-transform">▾</span>
        </summary>
        <div className="px-4 pb-4 grid gap-4">
          <MetricSlider label="Energy" value={today.energy} max={5} onChange={v=>onRegenerateWeights(v,today.difficulty,today.sleepHours)} />
          <MetricSlider label="Difficulty" value={today.difficulty} max={5} onChange={v=>onRegenerateWeights(today.energy,v,today.sleepHours)} />
          <MetricSlider label="Sleep (hrs)" value={today.sleepHours??0} max={12} onChange={v=>onRegenerateWeights(today.energy,today.difficulty,v||undefined)} />
        </div>
      </details>
      <div className="flex flex-col gap-3 stagger-children mb-6">
        {today.workout.map((ex,idx)=>{
          const log=today.logs.find(l=>l.exerciseId===ex.id);
          const isLogged=log?.actualWeightLb!==undefined||log?.actualReps!==undefined;
          const isPrimary=ex.primary!=='accessory';
          return (
            <button key={ex.id} onClick={()=>{setCurrentExIndex(idx);setShowOverview(false);}} className={`w-full text-left p-4 rounded-card border transition-all active:scale-[0.98] ${isPrimary?'bg-accent/[0.04] border-accent/[0.12]':'bg-surface-card border-white/[0.08]'} hover:bg-white/[0.06]`}>
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${isLogged?'bg-success/20 text-success':'bg-white/5 text-white/30'}`}>{isLogged?'✓':idx+1}</div>
                <div className="flex-1 min-w-0">
                  <div className={`font-semibold truncate ${isPrimary?'text-accent':'text-white'}`}>{ex.name}</div>
                  <div className="text-caption text-white/30">{ex.sets}×{ex.reps}{ex.targetWeightLb&&<span className="ml-2 text-white/50">@ {ex.targetWeightLb} lb</span>}</div>
                </div>
                <span className="text-white/20 text-lg">›</span>
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex gap-3">
        {!isCompleted?(<button onClick={()=>onMarkComplete(true)} className="btn-success flex-1 flex items-center justify-center gap-2"><span>✓</span> Complete Workout</button>):(<button onClick={()=>onMarkComplete(false)} className="btn-secondary flex-1">↩ Mark Incomplete</button>)}
        <button onClick={onGenerate} className="btn-secondary px-4">+ New</button>
      </div>
    </div>
  );

  // SINGLE EXERCISE VIEW
  const isPrimary = currentEx.primary!=='accessory';
  const isDumbbell = currentEx.name.toLowerCase().includes('dumbbell')||currentEx.name.toLowerCase().includes('lateral raise')||currentEx.name.toLowerCase().includes('hammer curl');
  const lastPerf = isPrimary&&currentEx.primary!=='accessory'?findLastLiftPerformance(history.slice(1),currentEx.primary as LiftKey):findLastAccessoryPerformance(history.slice(1),currentEx.name);
  const weightDelta = lastPerf?.exercise?.targetWeightLb&&currentEx.targetWeightLb?currentEx.targetWeightLb-lastPerf.exercise.targetWeightLb:null;

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <button onClick={()=>setShowOverview(true)} className="flex items-center gap-2 text-caption text-white/40 hover:text-white/70 transition-colors py-2">‹ All Exercises</button>
        <div className="text-caption text-white/30">{currentExIndex+1} / {today.workout.length}</div>
      </div>
      <div className={`rounded-2xl border p-6 mb-6 ${isPrimary?'bg-accent/[0.04] border-accent/[0.12]':'card'}`}>
        <div className="mb-2">
          <div className="text-caption text-white/30 mb-1">{currentEx.muscleGroups.join(' · ')}</div>
          <h2 className={`text-heading ${isPrimary?'text-accent':'text-white'}`}>{currentEx.name}</h2>
          <div className="text-body text-white/40 mt-1">{currentEx.sets} sets × {currentEx.reps} reps</div>
        </div>
        {currentEx.targetWeightLb!==undefined&&(
          <div className="my-8 text-center">
            <div className="text-hero text-white leading-none">{currentEx.targetWeightLb}<span className="text-display text-white/30 ml-1">lb</span></div>
            {isDumbbell&&<div className="text-caption text-white/30 mt-1">per dumbbell</div>}
            {weightDelta!==null&&weightDelta!==0&&(<div className={`mt-2 text-caption font-bold ${weightDelta>0?'text-success':'text-danger'}`}>{weightDelta>0?'↑':'↓'} {Math.abs(weightDelta)} lbs from last time</div>)}
          </div>
        )}
      </div>
      <div className="card p-5 mb-6">
        <div className="field-label mb-4">Log Your Sets</div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1.5">Weight{isDumbbell?' (each)':''} lb</label><input type="number" value={currentLog?.actualWeightLb??''} onChange={e=>onUpdateLog(currentEx.id,{actualWeightLb:e.target.value===''?undefined:Number(e.target.value)})} placeholder={currentEx.targetWeightLb?.toString()||'—'} className="input-dark text-center text-lg font-bold" /></div>
          <div><label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1.5">Reps</label><input type="text" value={currentLog?.actualReps??''} onChange={e=>onUpdateLog(currentEx.id,{actualReps:e.target.value})} placeholder="10,9,8" className="input-dark text-center text-lg font-bold" /></div>
          <div><label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1.5">RPE</label><input type="number" min={1} max={10} value={currentLog?.rpe??''} onChange={e=>onUpdateLog(currentEx.id,{rpe:e.target.value===''?undefined:clamp(Number(e.target.value),1,10)})} placeholder="7" className="input-dark text-center text-lg font-bold" /></div>
        </div>
      </div>
      <div className="flex gap-3">
        <button onClick={()=>setCurrentExIndex(Math.max(0,currentExIndex-1))} disabled={currentExIndex===0} className={`btn-secondary flex-1 ${currentExIndex===0?'opacity-30 cursor-not-allowed':''}`}>‹ Previous</button>
        {currentExIndex<today.workout.length-1?(<button onClick={handleNext} className="btn-accent flex-1">Next ›</button>):(<button onClick={handleFinish} className="btn-success flex-1">✓ Finish</button>)}
      </div>
      {/* Manual rest timer trigger */}
      {restTimerPrefs.enabled && (
        <button
          onClick={() => {
            const dur = getRestDuration(currentEx, restTimerPrefs);
            setRestTimerDuration(dur);
            setPendingNextIndex(null);
            setPendingFinish(false);
            setShowRestTimer(true);
          }}
          className="w-full mt-3 py-2.5 text-caption text-white/30 hover:text-white/50 transition-colors flex items-center justify-center gap-2"
        >
          ⏱️ Start rest timer ({Math.floor(getRestDuration(currentEx, restTimerPrefs) / 60)}:{String(getRestDuration(currentEx, restTimerPrefs) % 60).padStart(2, '0')})
        </button>
      )}
    </div>
  );
}

// ============================================================================
// PROGRESS VIEW
// ============================================================================

function ProgressView({history}:{history:Session[]}) {
  const [selectedLift, setSelectedLift] = useState<LiftKey|'all'>('all');
  const [volumeTimeframe, setVolumeTimeframe] = useState<7|14|30>(7);

  if (!history.length) return (
    <div className="text-center py-20 animate-fade-in">
      <div className="text-5xl mb-4">📊</div>
      <h2 className="text-display text-white mb-3">No History Yet</h2>
      <p className="text-body text-white/40">Complete your first workout to see progress.</p>
    </div>
  );

  const stats = calculateStreakStats(history);
  const prs = findPersonalRecords(history);
  const hasPRs = Object.values(prs).some(pr=>pr!==null);
  const progressData = extractProgressData(history, selectedLift);
  const volumes = calculateMuscleGroupVolume(history, volumeTimeframe);
  const sortedMuscles = Object.entries(volumes).sort(([,a],[,b])=>b-a);
  const maxVolume = Math.max(...Object.values(volumes), 1);
  const volumeTrends = calculateVolumeTrends(history, 8);

  return (
    <div className="animate-fade-in">
      <h2 className="text-display text-white mb-6">Progress</h2>
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[{label:'Streak',value:stats.currentStreak,icon:'🔥',color:'#fb923c'},{label:'This Week',value:stats.workoutsThisWeek,icon:'📅',color:'#64c8ff'},{label:'Total',value:stats.totalWorkouts,icon:'💪',color:'#6ee7b7'}].map(item=>(
          <div key={item.label} className="card p-4 text-center">
            <div className="text-xl mb-1">{item.icon}</div>
            <div className="text-heading font-extrabold" style={{color:item.color}}>{item.value}</div>
            <div className="text-label text-white/40">{item.label}</div>
          </div>
        ))}
      </div>
      {hasPRs&&(
        <div className="card p-5 mb-6" style={{background:'linear-gradient(135deg,rgba(251,191,36,0.06),rgba(251,191,36,0.02))'}}>
          <h3 className="text-subheading text-white mb-4 flex items-center gap-2">🏆 Personal Records</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(Object.entries(prs) as [LiftKey,{weight:number;date:string}|null][]).filter(([,pr])=>pr!==null).map(([lift,pr])=>(
              <div key={lift} className="bg-black/30 rounded-xl p-3 border-l-[3px]" style={{borderColor:LIFT_COLORS[lift]}}>
                <div className="text-label text-white/40 mb-1">{LIFT_NAMES[lift]}</div>
                <div className="text-heading font-extrabold" style={{color:LIFT_COLORS[lift]}}>{pr!.weight}<span className="text-caption font-normal text-white/30 ml-1">lb</span></div>
                <div className="text-[10px] text-white/30 mt-1">{formatDateShort(pr!.date)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {sortedMuscles.length>0&&(
        <div className="card p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-subheading text-white flex items-center gap-2">🎯 Muscle Volume</h3>
            <div className="flex gap-1.5">
              {([7,14,30] as const).map(d=>(
                <button key={d} onClick={()=>setVolumeTimeframe(d)} className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${volumeTimeframe===d?'bg-accent/20 text-accent border border-accent/30':'bg-white/5 text-white/40 border border-transparent'}`}>{d}d</button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3">
            {sortedMuscles.map(([muscle,volume])=>(
              <div key={muscle}>
                <div className="flex justify-between mb-1.5">
                  <span className="text-caption font-semibold text-white">{muscle}</span>
                  <span className="text-caption text-white/30">{Math.round(volume/1000)}k</span>
                </div>
                <div className="h-5 bg-white/5 rounded-md overflow-hidden">
                  <div className="h-full rounded-md transition-all duration-500 ease-out bg-accent/60" style={{width:`${(volume/maxVolume)*100}%`}} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mb-4">
        <div className="field-label mb-2">Filter Lifts</div>
        <div className="flex gap-2 flex-wrap">
          {['all','bench','squat','deadlift','ohp','row'].map(lift=>(
            <button key={lift} onClick={()=>setSelectedLift(lift as LiftKey|'all')} className={`px-3 py-1.5 rounded-lg text-caption font-semibold transition-all ${selectedLift===lift?'bg-accent/20 text-accent border border-accent/30':'bg-white/5 text-white/40 border border-transparent hover:bg-white/10'}`}>{lift==='all'?'All':LIFT_NAMES[lift as LiftKey]}</button>
          ))}
        </div>
      </div>
      {progressData.length>1&&<LiftChart data={progressData} />}
      {volumeTrends.length>=2&&(
        <div className="card p-5 mb-6">
          <h3 className="text-subheading text-white mb-4 flex items-center gap-2">📊 Weekly Volume</h3>
          <VolumeMiniChart data={volumeTrends} />
        </div>
      )}
      <div className="mb-6">
        <h3 className="text-subheading text-white mb-4">Recent Sessions</h3>
        <div className="flex flex-col gap-3">
          {history.slice(0,10).map((session,idx)=>(<SessionCard key={session.id} session={session} isLatest={idx===0} />))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// CHART COMPONENTS
// ============================================================================

function LiftChart({data}:{data:ReturnType<typeof extractProgressData>}) {
  if (data.length<2) return null;
  const liftGroups: Record<string, typeof data> = {};
  data.forEach(p=>{if(!liftGroups[p.lift])liftGroups[p.lift]=[];liftGroups[p.lift].push(p);});
  const W=640,H=280,pad={top:30,right:20,bottom:40,left:50};
  const iW=W-pad.left-pad.right, iH=H-pad.top-pad.bottom;
  const weights=data.map(d=>d.weight);
  const minW=Math.floor(Math.min(...weights)/10)*10-10, maxW=Math.ceil(Math.max(...weights)/10)*10+10;
  const xS=(i:number)=>pad.left+(i/Math.max(1,data.length-1))*iW;
  const yS=(w:number)=>H-pad.bottom-((w-minW)/(maxW-minW))*iH;
  return (
    <div className="card p-5 mb-6 overflow-x-auto">
      <h3 className="text-subheading text-white mb-4 flex items-center gap-2">💪 Lift Progress</h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{minWidth:400}}>
        {[0,0.25,0.5,0.75,1].map(pct=>{const y=H-pad.bottom-pct*iH;return(<g key={pct}><line x1={pad.left} y1={y} x2={W-pad.right} y2={y} stroke="rgba(255,255,255,0.07)" strokeWidth={1}/><text x={pad.left-8} y={y+4} fill="rgba(255,255,255,0.3)" fontSize={10} textAnchor="end">{Math.round(minW+pct*(maxW-minW))}</text></g>);})}
        {Object.entries(liftGroups).map(([lift,points])=>{
          const pathD=points.map((p,i)=>{const x=xS(data.indexOf(p)),y=yS(p.weight);return i===0?`M ${x} ${y}`:`L ${x} ${y}`;}).join(' ');
          return(<g key={lift}><path d={pathD} fill="none" stroke={LIFT_COLORS[lift as LiftKey]} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>{points.map((p,i)=>(<circle key={i} cx={xS(data.indexOf(p))} cy={yS(p.weight)} r={4} fill={LIFT_COLORS[lift as LiftKey]} stroke="#0a0a0f" strokeWidth={2}><title>{`${p.liftName}: ${p.weight} lb - ${p.date}`}</title></circle>))}</g>);
        })}
        {data.filter((_,i)=>i%Math.max(1,Math.floor(data.length/5))===0||i===data.length-1).map((p)=>(<text key={data.indexOf(p)} x={xS(data.indexOf(p))} y={H-pad.bottom+16} fill="rgba(255,255,255,0.3)" fontSize={9} textAnchor="middle">{p.date}</text>))}
      </svg>
      <div className="flex gap-4 mt-4 flex-wrap justify-center">
        {Object.entries(liftGroups).map(([lift,points])=>(<div key={lift} className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{background:LIFT_COLORS[lift as LiftKey]}}/><span className="text-caption text-white/50">{LIFT_NAMES[lift as LiftKey]} ({points.length})</span></div>))}
      </div>
    </div>
  );
}

function VolumeMiniChart({data}:{data:Array<{week:string;volume:number;workouts:number}>}) {
  if (data.length<2) return null;
  const W=600,H=160,pad={top:20,right:10,bottom:30,left:45};
  const iW=W-pad.left-pad.right,iH=H-pad.top-pad.bottom;
  const maxV=Math.max(...data.map(d=>d.volume)),minV=Math.min(...data.map(d=>d.volume)),range=maxV-minV||1;
  const xS=(i:number)=>pad.left+(i/(data.length-1))*iW;
  const yS=(v:number)=>H-pad.bottom-((v-minV)/range)*iH;
  const line=data.map((d,i)=>`${i===0?'M':'L'} ${xS(i)} ${yS(d.volume)}`).join(' ');
  const area=`${line} L ${xS(data.length-1)} ${H-pad.bottom} L ${pad.left} ${H-pad.bottom} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <defs><linearGradient id="volGrad" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#4ade80" stopOpacity={0.25}/><stop offset="100%" stopColor="#4ade80" stopOpacity={0.02}/></linearGradient></defs>
      {[0,0.5,1].map(pct=>{const y=H-pad.bottom-pct*iH;return(<g key={pct}><line x1={pad.left} y1={y} x2={W-pad.right} y2={y} stroke="rgba(255,255,255,0.06)"/><text x={pad.left-6} y={y+4} fill="rgba(255,255,255,0.25)" fontSize={9} textAnchor="end">{Math.round((minV+pct*range)/1000)}k</text></g>);})}
      <path d={area} fill="url(#volGrad)"/><path d={line} fill="none" stroke="#4ade80" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
      {data.map((d,i)=>(<g key={i}><circle cx={xS(i)} cy={yS(d.volume)} r={4} fill="#4ade80" stroke="#0a0a0f" strokeWidth={2}/><text x={xS(i)} y={H-pad.bottom+14} fill="rgba(255,255,255,0.25)" fontSize={8} textAnchor="middle">{d.workouts}w</text></g>))}
    </svg>
  );
}

function SessionCard({session,isLatest}:{session:Session;isLatest:boolean}) {
  const [expanded, setExpanded] = useState(false);
  const primaryLifts = session.workout.filter(ex=>ex.primary!=='accessory'&&ex.targetWeightLb);
  return (
    <div className={`card overflow-hidden ${isLatest?'border-accent/20 bg-accent/[0.03]':''}`}>
      <button onClick={()=>setExpanded(!expanded)} className="w-full text-left p-4 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-subheading text-white">{session.dayType}</span>
            {isLatest&&<span className="badge-accent text-[9px]">Latest</span>}
          </div>
          <div className="text-caption text-white/30 truncate">
            {formatDate(session.dateISO)} · E{session.energy} D{session.difficulty}
            {primaryLifts.length>0&&` · ${primaryLifts.map(l=>`${LIFT_NAMES[l.primary as LiftKey]||l.primary} ${l.targetWeightLb}`).join(', ')}`}
          </div>
        </div>
        <span className={`text-white/20 transition-transform ${expanded?'rotate-180':''}`}>▾</span>
      </button>
      {expanded&&(
        <div className="px-4 pb-4 border-t border-white/[0.06] pt-3 flex flex-col gap-2 animate-fade-in">
          {session.workout.map(ex=>(<div key={ex.id} className={`p-3 rounded-lg text-caption ${ex.primary!=='accessory'?'bg-accent/[0.06]':'bg-black/20'}`}><span className="font-semibold text-white">{ex.name}</span><span className="text-white/30 ml-2">{ex.sets}x{ex.reps}{ex.targetWeightLb?` @ ${ex.targetWeightLb} lb`:''}</span></div>))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PROFILE VIEW
// ============================================================================

function ProfileView({profile,draftSetup,setDraftSetup,onSaveSetup,onLoadDemo,onExport,onImport,onReset,restTimerPrefs,onUpdateRestPrefs}:{
  profile:UserProfile|null;draftSetup:Setup;setDraftSetup:(s:Setup)=>void;
  onSaveSetup:()=>void;onLoadDemo:()=>void;onExport:()=>void;
  onImport:(e:React.ChangeEvent<HTMLInputElement>)=>void;onReset:()=>void;
  restTimerPrefs:RestTimerPreferences;onUpdateRestPrefs:(p:RestTimerPreferences)=>void;
}) {
  const importRef = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState(false);
  function handleSave(){onSaveSetup();setSaved(true);setTimeout(()=>setSaved(false),2000);}

  return (
    <div className="animate-fade-in">
      <h2 className="text-display text-white mb-6">Profile</h2>
      {profile&&(
        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold text-black" style={{background:profile.avatarColor}}>{profile.displayName.charAt(0).toUpperCase()}</div>
          <div>
            <div className="text-heading text-white">{profile.displayName}</div>
            <div className="text-caption text-white/30">{profile.history.length} workouts · Joined {formatDateShort(profile.createdAt)}</div>
          </div>
        </div>
      )}
      <div className="card p-5 mb-6">
        <h3 className="text-subheading text-white mb-5">Training Setup</h3>
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div className="col-span-2"><label className="field-label">Name</label><input type="text" value={draftSetup.name??''} onChange={e=>setDraftSetup({...draftSetup,name:e.target.value})} className="input-dark"/></div>
          <div><label className="field-label">Height (in)</label><input type="number" value={draftSetup.heightIn} onChange={e=>setDraftSetup({...draftSetup,heightIn:Number(e.target.value)})} className="input-dark"/></div>
          <div><label className="field-label">Weight (lb)</label><input type="number" value={draftSetup.weightLb} onChange={e=>setDraftSetup({...draftSetup,weightLb:Number(e.target.value)})} className="input-dark"/></div>
          <div className="col-span-2"><label className="field-label">Goal</label><select value={draftSetup.goal} onChange={e=>setDraftSetup({...draftSetup,goal:e.target.value as Setup['goal']})} className="input-dark cursor-pointer"><option value="Hypertrophy">Hypertrophy</option><option value="Strength">Strength</option><option value="Health">Health</option></select></div>
        </div>
        <div className="mb-5">
          <h4 className="text-caption font-bold text-white/60 mb-3">5-Rep Max (lbs)</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(['bench','squat','deadlift','ohp','row'] as LiftKey[]).map(k=>(<div key={k}><label className="field-label">{k.toUpperCase()}</label><input type="number" value={draftSetup.fiveRM[k]} onChange={e=>setDraftSetup({...draftSetup,fiveRM:{...draftSetup.fiveRM,[k]:Number(e.target.value)}})} className="input-dark"/></div>))}
          </div>
        </div>
        <button onClick={handleSave} className={`w-full ${saved?'btn-success':'btn-primary'} transition-all`}>{saved?'✓ Saved!':'Save Profile'}</button>
      </div>
      <RestTimerSettings prefs={restTimerPrefs} onChange={onUpdateRestPrefs} />
      <div className="card p-5 mb-6">
        <h3 className="text-subheading text-white mb-4">Data</h3>
        <div className="flex flex-col gap-3">
          <button onClick={onExport} className="btn-secondary w-full flex items-center justify-center gap-2">📤 Export Data</button>
          <input ref={importRef} type="file" accept=".json" onChange={onImport} className="hidden"/>
          <button onClick={()=>importRef.current?.click()} className="btn-secondary w-full flex items-center justify-center gap-2">📥 Import Backup</button>
          <button onClick={onLoadDemo} className="btn-secondary w-full flex items-center justify-center gap-2">🎮 Load Demo Data</button>
        </div>
      </div>
      <div className="card p-5 mb-6 border-danger/20">
        <h3 className="text-subheading text-danger mb-4">Danger Zone</h3>
        <button onClick={onReset} className="btn-danger w-full">Reset All Data</button>
      </div>
      <div className="card p-5">
        <h3 className="text-subheading text-white mb-3">About FLEX</h3>
        <p className="text-body text-white/50 mb-3">Adaptive strength training that adjusts to how you feel. Built with React, TypeScript & Next.js.</p>
        <div className="text-caption text-white/30">Built by Paul Ancin · <a href="https://www.linkedin.com/in/paul-ancin/" target="_blank" rel="noopener noreferrer" className="text-accent/70 hover:text-accent transition-colors">LinkedIn</a></div>
      </div>
    </div>
  );
}

// ============================================================================
// SHARED COMPONENTS
// ============================================================================

function MetricSlider({label,value,max,onChange}:{label:string;value:number;max:number;onChange:(v:number)=>void}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-caption text-white/40 w-24 shrink-0">{label}</span>
      <input type="range" min={0} max={max} value={value} onChange={e=>onChange(Number(e.target.value))} className="flex-1"/>
      <input type="number" min={0} max={max} value={value} onChange={e=>onChange(clamp(Number(e.target.value),0,max))} className="w-14 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white text-center text-caption font-bold outline-none"/>
    </div>
  );
}
