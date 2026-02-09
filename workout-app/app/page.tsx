'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';

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

// NEW: User Profile type for multi-user support
type UserProfile = {
  id: string;
  displayName: string;
  avatarColor: string;
  createdAt: string;
  lastActiveAt: string;
  setup: Setup | null;
  history: Session[];
  preferences: {
    theme: 'dark' | 'light';
    units: 'imperial' | 'metric';
  };
};

type AppState = {
  profiles: UserProfile[];
  activeProfileId: string | null;
};

// ============================================================================
// CONSTANTS & UTILITIES
// ============================================================================

const LS_KEY = 'flex_app_v2';
const OLD_LS_KEY = 'workout_mvp_v1';

const AVATAR_COLORS = [
  '#64c8ff', '#ff6b9d', '#ffd93d', '#95e1d3', '#c77dff',
  '#ff8c42', '#6bcb77', '#4d96ff', '#ff6b6b', '#a8e6cf'
];

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function estimate1RMFrom5RM(fiveRM: number) {
  return fiveRM * (1 + 5 / 30);
}

function trainingMax(oneRM: number) {
  return oneRM * 0.9;
}

function roundTo2_5(x: number) {
  return Math.round(x / 2.5) * 2.5;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDateShort(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getWeekNumber(date: Date): string {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  const weekNum = Math.ceil((days + startOfYear.getDay() + 1) / 7);
  return `W${weekNum} ${date.getFullYear()}`;
}

function getMonthKey(date: Date): string {
  return `${date.toLocaleString('default', { month: 'short' })} ${date.getFullYear()}`;
}

function getDaysBetween(date1: Date, date2: Date): number {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.round(Math.abs((date1.getTime() - date2.getTime()) / oneDay));
}

// Calculate volume (sets × reps × weight) for a session
function calculateSessionVolume(session: Session): number {
  return session.workout.reduce((total, exercise) => {
    const weight = exercise.targetWeightLb || 0;
    const sets = exercise.sets;
    // Parse reps range (e.g., "6-10" -> average of 8)
    const repsMatch = exercise.reps.match(/(\d+)(?:-(\d+))?/);
    const reps = repsMatch 
      ? repsMatch[2] 
        ? (parseInt(repsMatch[1]) + parseInt(repsMatch[2])) / 2 
        : parseInt(repsMatch[1])
      : 0;
    return total + (sets * reps * weight);
  }, 0);
}

// Calculate muscle group volume from sessions
function calculateMuscleGroupVolume(history: Session[], days: number = 7): Record<string, number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  
  const volumes: Record<string, number> = {};
  
  history
    .filter(s => new Date(s.dateISO) >= cutoff)
    .forEach(session => {
      session.workout.forEach(exercise => {
        const weight = exercise.targetWeightLb || 50; // Default weight for accessories
        const sets = exercise.sets;
        const repsMatch = exercise.reps.match(/(\d+)(?:-(\d+))?/);
        const reps = repsMatch 
          ? repsMatch[2] 
            ? (parseInt(repsMatch[1]) + parseInt(repsMatch[2])) / 2 
            : parseInt(repsMatch[1])
          : 8;
        const volume = sets * reps * weight;
        
        exercise.muscleGroups.forEach(mg => {
          volumes[mg] = (volumes[mg] || 0) + volume;
        });
      });
    });
  
  return volumes;
}

// Find personal records for each lift
function findPersonalRecords(history: Session[]): Record<LiftKey, { weight: number; date: string; } | null> {
  const prs: Record<LiftKey, { weight: number; date: string; } | null> = {
    bench: null, squat: null, deadlift: null, ohp: null, row: null
  };
  
  history.forEach(session => {
    session.workout.forEach(exercise => {
      if (exercise.primary !== 'accessory' && exercise.targetWeightLb) {
        const lift = exercise.primary as LiftKey;
        if (!prs[lift] || exercise.targetWeightLb > prs[lift]!.weight) {
          prs[lift] = { weight: exercise.targetWeightLb, date: session.dateISO };
        }
      }
    });
  });
  
  return prs;
}

// Calculate workout streak and consistency stats
function calculateStreakStats(history: Session[]): {
  currentStreak: number;
  longestStreak: number;
  workoutsThisWeek: number;
  workoutsThisMonth: number;
  avgWorkoutsPerWeek: number;
  totalWorkouts: number;
} {
  if (history.length === 0) {
    return { currentStreak: 0, longestStreak: 0, workoutsThisWeek: 0, workoutsThisMonth: 0, avgWorkoutsPerWeek: 0, totalWorkouts: 0 };
  }
  
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  const workoutsThisWeek = history.filter(s => new Date(s.dateISO) >= oneWeekAgo).length;
  const workoutsThisMonth = history.filter(s => new Date(s.dateISO) >= oneMonthAgo).length;
  
  // Sort by date descending
  const sortedDates = history
    .map(s => new Date(s.dateISO))
    .sort((a, b) => b.getTime() - a.getTime());
  
  // Calculate current streak (consecutive days/weeks with workouts)
  let currentStreak = 0;
  let checkDate = new Date();
  checkDate.setHours(0, 0, 0, 0);
  
  // Allow for 2-day gaps (realistic rest days)
  for (let i = 0; i < sortedDates.length; i++) {
    const workoutDate = new Date(sortedDates[i]);
    workoutDate.setHours(0, 0, 0, 0);
    const daysDiff = getDaysBetween(checkDate, workoutDate);
    
    if (daysDiff <= 3) { // Allow up to 3 days between workouts for streak
      currentStreak++;
      checkDate = workoutDate;
    } else {
      break;
    }
  }
  
  // Calculate longest streak
  let longestStreak = 0;
  let tempStreak = 1;
  
  for (let i = 1; i < sortedDates.length; i++) {
    const prevDate = new Date(sortedDates[i - 1]);
    const currDate = new Date(sortedDates[i]);
    const daysDiff = getDaysBetween(prevDate, currDate);
    
    if (daysDiff <= 3) {
      tempStreak++;
    } else {
      longestStreak = Math.max(longestStreak, tempStreak);
      tempStreak = 1;
    }
  }
  longestStreak = Math.max(longestStreak, tempStreak);
  
  // Calculate average workouts per week
  if (history.length >= 2) {
    const oldestDate = sortedDates[sortedDates.length - 1];
    const newestDate = sortedDates[0];
    const weeksBetween = Math.max(1, getDaysBetween(oldestDate, newestDate) / 7);
    const avgWorkoutsPerWeek = Math.round((history.length / weeksBetween) * 10) / 10;
    
    return {
      currentStreak,
      longestStreak,
      workoutsThisWeek,
      workoutsThisMonth,
      avgWorkoutsPerWeek,
      totalWorkouts: history.length,
    };
  }
  
  return {
    currentStreak,
    longestStreak,
    workoutsThisWeek,
    workoutsThisMonth,
    avgWorkoutsPerWeek: history.length,
    totalWorkouts: history.length,
  };
}

// Calculate weekly volume trends
function calculateVolumeTrends(history: Session[], weeks: number = 8): Array<{ week: string; volume: number; workouts: number; }> {
  const weeklyData: Record<string, { volume: number; workouts: number }> = {};
  
  history.forEach(session => {
    const date = new Date(session.dateISO);
    const weekKey = getWeekNumber(date);
    
    if (!weeklyData[weekKey]) {
      weeklyData[weekKey] = { volume: 0, workouts: 0 };
    }
    
    weeklyData[weekKey].volume += calculateSessionVolume(session);
    weeklyData[weekKey].workouts += 1;
  });
  
  // Convert to array and sort by date (oldest to newest for proper chart display)
  return Object.entries(weeklyData)
    .map(([week, data]) => ({ week, ...data }))
    .sort((a, b) => {
      // Parse week format "W## YYYY" to compare chronologically
      const parseWeek = (w: string) => {
        const match = w.match(/W(\d+)\s+(\d+)/);
        if (!match) return 0;
        return parseInt(match[2]) * 100 + parseInt(match[1]);
      };
      return parseWeek(a.week) - parseWeek(b.week);
    })
    .slice(-weeks);
}

function getRelativeTime(iso: string): string {
  const now = new Date();
  const date = new Date(iso);
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return formatDate(iso);
}

function pickNextDayType(history: Session[]): DayType {
  const recent = history.slice(0, 4).map(h => h.dayType);
  const order: DayType[] = ['Chest & Triceps', 'Back & Biceps', 'Legs', 'Arms'];

  for (const dt of order) {
    if (!recent.includes(dt)) return dt;
  }
  const last = history[0]?.dayType;
  if (!last) return 'Chest & Triceps';
  const idx = order.indexOf(last);
  return order[(idx + 1) % order.length];
}

function baseWorkoutTemplate(dayType: DayType): Exercise[] {
  if (dayType === 'Chest & Triceps') {
    return [
      { id: uid('ex'), name: 'Barbell Bench Press', primary: 'bench', muscleGroups: ['Chest', 'Triceps', 'Shoulders'], sets: 4, reps: '6-10' },
      { id: uid('ex'), name: 'Incline Dumbbell Press', primary: 'accessory', muscleGroups: ['Chest'], sets: 3, reps: '8-12' },
      { id: uid('ex'), name: 'Dips (Assisted if needed)', primary: 'accessory', muscleGroups: ['Chest', 'Triceps'], sets: 3, reps: '6-12' },
      { id: uid('ex'), name: 'Triceps Rope Pushdown', primary: 'accessory', muscleGroups: ['Triceps'], sets: 3, reps: '10-15' },
      { id: uid('ex'), name: 'Overhead Triceps Extension', primary: 'accessory', muscleGroups: ['Triceps'], sets: 3, reps: '10-15' },
    ];
  }
  if (dayType === 'Back & Biceps') {
    return [
      { id: uid('ex'), name: 'Barbell Row', primary: 'row', muscleGroups: ['Back', 'Biceps'], sets: 4, reps: '6-10' },
      { id: uid('ex'), name: 'Pull-Ups / Lat Pulldown', primary: 'accessory', muscleGroups: ['Back'], sets: 3, reps: '6-12' },
      { id: uid('ex'), name: 'Seated Cable Row', primary: 'accessory', muscleGroups: ['Back'], sets: 3, reps: '8-12' },
      { id: uid('ex'), name: 'Face Pulls', primary: 'accessory', muscleGroups: ['Rear Delts', 'Upper Back'], sets: 3, reps: '12-15' },
      { id: uid('ex'), name: 'Dumbbell Curls', primary: 'accessory', muscleGroups: ['Biceps'], sets: 3, reps: '10-15' },
    ];
  }
  if (dayType === 'Legs') {
    return [
      { id: uid('ex'), name: 'Back Squat', primary: 'squat', muscleGroups: ['Quads', 'Glutes'], sets: 4, reps: '5-8' },
      { id: uid('ex'), name: 'Romanian Deadlift', primary: 'accessory', muscleGroups: ['Hamstrings', 'Glutes'], sets: 3, reps: '6-10' },
      { id: uid('ex'), name: 'Leg Press', primary: 'accessory', muscleGroups: ['Quads'], sets: 3, reps: '10-15' },
      { id: uid('ex'), name: 'Hamstring Curl', primary: 'accessory', muscleGroups: ['Hamstrings'], sets: 3, reps: '10-15' },
      { id: uid('ex'), name: 'Calf Raises', primary: 'accessory', muscleGroups: ['Calves'], sets: 3, reps: '12-20' },
    ];
  }
  return [
    { id: uid('ex'), name: 'Overhead Press', primary: 'ohp', muscleGroups: ['Shoulders', 'Triceps'], sets: 4, reps: '6-10' },
    { id: uid('ex'), name: 'Lateral Raises', primary: 'accessory', muscleGroups: ['Shoulders'], sets: 3, reps: '12-15' },
    { id: uid('ex'), name: 'Incline Dumbbell Curls', primary: 'accessory', muscleGroups: ['Biceps'], sets: 3, reps: '10-15' },
    { id: uid('ex'), name: 'Skull Crushers', primary: 'accessory', muscleGroups: ['Triceps'], sets: 3, reps: '8-12' },
    { id: uid('ex'), name: 'Hammer Curls', primary: 'accessory', muscleGroups: ['Biceps', 'Forearms'], sets: 3, reps: '10-15' },
  ];
}

function findLastLiftPerformance(history: Session[], lift: LiftKey) {
  for (const s of history) {
    for (const ex of s.workout) {
      if (ex.primary === lift && ex.targetWeightLb) {
        const log = s.logs.find(l => l.exerciseId === ex.id);
        return { session: s, exercise: ex, log };
      }
    }
  }
  return null;
}

function computeTargetWeightLb(args: { setup: Setup; history: Session[]; lift: LiftKey; dayType: DayType; currentEnergy?: number; currentSleep?: number; }) {
  const { setup, history, lift, currentEnergy = 3, currentSleep } = args;
  const oneRM = estimate1RMFrom5RM(setup.fiveRM[lift] || 0);
  const tMax = trainingMax(oneRM);
  const basePct = setup.goal === 'Strength' ? 0.8 : setup.goal === 'Health' ? 0.65 : 0.7;
  let target = tMax * basePct;
  let sessionModifier = 0;
  if (currentEnergy <= 2) sessionModifier -= 5;
  else if (currentEnergy >= 4) sessionModifier += 5;
  if (currentSleep !== undefined) {
    if (currentSleep < 6) sessionModifier -= 2.5;
    else if (currentSleep >= 8) sessionModifier += 2.5;
  }
  const last = findLastLiftPerformance(history, lift);
  if (last?.exercise?.targetWeightLb) {
    const lastW = last.exercise.targetWeightLb;
    const lastDifficulty = last.session.difficulty;
    const lastEnergy = last.session.energy;
    let bump = 0;
    if (lastDifficulty <= 2 && lastEnergy >= 4) bump = 5;
    else if (lastDifficulty === 3) bump = 2.5;
    else if (lastDifficulty >= 4 || lastEnergy <= 2) bump = -5;
    target = lastW + bump;
  }
  target += sessionModifier;
  target = clamp(target, tMax * 0.55, tMax * 0.9);
  return roundTo2_5(target);
}

// ============================================================================
// ACCESSORY WEIGHT SUGGESTIONS
// ============================================================================

// Find the last time a user performed a specific exercise by name
function findLastAccessoryPerformance(history: Session[], exerciseName: string): { session: Session; exercise: Exercise; log?: ExerciseLog } | null {
  for (const s of history) {
    for (const ex of s.workout) {
      if (ex.name === exerciseName && ex.targetWeightLb) {
        const log = s.logs.find(l => l.exerciseId === ex.id);
        return { session: s, exercise: ex, log };
      }
    }
  }
  return null;
}

// Default weight ratios relative to primary lifts (conservative starting points)
// These are percentages of the relevant primary lift's working weight
const ACCESSORY_DEFAULTS: Record<string, { relativeTo: LiftKey; ratio: number; minWeight: number; isPerDumbbell?: boolean }> = {
  // Chest & Triceps accessories
  'Incline Dumbbell Press': { relativeTo: 'bench', ratio: 0.35, minWeight: 20, isPerDumbbell: true },
  'Dips (Assisted if needed)': { relativeTo: 'bench', ratio: 0, minWeight: 0 }, // Bodyweight, 0 = BW
  'Triceps Rope Pushdown': { relativeTo: 'bench', ratio: 0.25, minWeight: 20 },
  'Overhead Triceps Extension': { relativeTo: 'bench', ratio: 0.20, minWeight: 15 },
  
  // Back & Biceps accessories
  'Pull-Ups / Lat Pulldown': { relativeTo: 'row', ratio: 0.65, minWeight: 60 },
  'Seated Cable Row': { relativeTo: 'row', ratio: 0.55, minWeight: 50 },
  'Face Pulls': { relativeTo: 'row', ratio: 0.25, minWeight: 20 },
  'Dumbbell Curls': { relativeTo: 'row', ratio: 0.15, minWeight: 15, isPerDumbbell: true },
  
  // Leg accessories
  'Romanian Deadlift': { relativeTo: 'deadlift', ratio: 0.50, minWeight: 95 },
  'Leg Press': { relativeTo: 'squat', ratio: 1.2, minWeight: 90 },
  'Hamstring Curl': { relativeTo: 'squat', ratio: 0.25, minWeight: 40 },
  'Calf Raises': { relativeTo: 'squat', ratio: 0.40, minWeight: 50 },
  
  // Arms day accessories
  'Lateral Raises': { relativeTo: 'ohp', ratio: 0.15, minWeight: 10, isPerDumbbell: true },
  'Incline Dumbbell Curls': { relativeTo: 'row', ratio: 0.12, minWeight: 12, isPerDumbbell: true },
  'Skull Crushers': { relativeTo: 'bench', ratio: 0.30, minWeight: 30 },
  'Hammer Curls': { relativeTo: 'row', ratio: 0.15, minWeight: 15, isPerDumbbell: true },
};

function computeAccessoryWeightLb(args: {
  setup: Setup;
  history: Session[];
  exerciseName: string;
  currentEnergy?: number;
  currentSleep?: number;
}): number | undefined {
  const { setup, history, exerciseName, currentEnergy = 3, currentSleep } = args;
  
  // Get default config for this exercise
  const defaultConfig = ACCESSORY_DEFAULTS[exerciseName];
  
  // Skip bodyweight exercises (ratio = 0)
  if (defaultConfig && defaultConfig.ratio === 0) {
    return undefined;
  }
  
  // Session modifiers (same logic as primary lifts but smaller increments for accessories)
  let sessionModifier = 0;
  if (currentEnergy <= 2) sessionModifier -= 2.5;
  else if (currentEnergy >= 4) sessionModifier += 2.5;
  if (currentSleep !== undefined) {
    if (currentSleep < 6) sessionModifier -= 2.5;
    else if (currentSleep >= 8) sessionModifier += 2.5;
  }
  
  // First, check if user has done this exercise before
  const lastPerformance = findLastAccessoryPerformance(history, exerciseName);
  
  if (lastPerformance?.exercise?.targetWeightLb) {
    const lastW = lastPerformance.exercise.targetWeightLb;
    const lastDifficulty = lastPerformance.session.difficulty;
    const lastEnergy = lastPerformance.session.energy;
    
    // Progressive overload logic (smaller increments for accessories)
    let bump = 0;
    if (lastDifficulty <= 2 && lastEnergy >= 4) bump = 2.5; // Easy last time, bump up
    else if (lastDifficulty === 3) bump = 0; // Just right, maintain
    else if (lastDifficulty >= 4 || lastEnergy <= 2) bump = -2.5; // Too hard, reduce
    
    let target = lastW + bump + sessionModifier;
    
    // Ensure minimum weight
    const minWeight = defaultConfig?.minWeight || 10;
    target = Math.max(target, minWeight);
    
    return roundTo2_5(target);
  }
  
  // No history - calculate smart default based on primary lift strength
  if (defaultConfig) {
    const primaryLiftWeight = setup.fiveRM[defaultConfig.relativeTo] || 0;
    if (primaryLiftWeight === 0) return undefined;
    
    // Calculate base weight from primary lift
    let baseWeight = primaryLiftWeight * defaultConfig.ratio;
    
    // Apply goal modifier
    if (setup.goal === 'Strength') baseWeight *= 1.1;
    else if (setup.goal === 'Health') baseWeight *= 0.85;
    
    // Apply session modifier
    baseWeight += sessionModifier;
    
    // Ensure minimum
    baseWeight = Math.max(baseWeight, defaultConfig.minWeight);
    
    return roundTo2_5(baseWeight);
  }
  
  // Unknown exercise - no suggestion
  return undefined;
}

// ============================================================================
// STORAGE FUNCTIONS
// ============================================================================

function createDefaultProfile(name: string): UserProfile {
  return {
    id: uid('profile'),
    displayName: name,
    avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    setup: null,
    history: [],
    preferences: {
      theme: 'dark',
      units: 'imperial',
    },
  };
}

function loadAppState(): AppState {
  if (typeof window === 'undefined') return { profiles: [], activeProfileId: null };
  
  // Try to load new format first
  const raw = window.localStorage.getItem(LS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return {
        profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
        activeProfileId: parsed.activeProfileId ?? null,
      };
    } catch {
      // Fall through to migration
    }
  }
  
  // Check for old format and migrate
  const oldRaw = window.localStorage.getItem(OLD_LS_KEY);
  if (oldRaw) {
    try {
      const oldData = JSON.parse(oldRaw);
      const migratedProfile: UserProfile = {
        id: uid('profile'),
        displayName: oldData.setup?.name || 'Migrated User',
        avatarColor: AVATAR_COLORS[0],
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        setup: oldData.setup ?? null,
        history: Array.isArray(oldData.history) ? oldData.history : [],
        preferences: { theme: 'dark', units: 'imperial' },
      };
      
      // Save migrated data and clean up old key
      const newState: AppState = {
        profiles: [migratedProfile],
        activeProfileId: migratedProfile.id,
      };
      saveAppState(newState);
      window.localStorage.removeItem(OLD_LS_KEY);
      
      return newState;
    } catch {
      // Fall through to empty state
    }
  }
  
  return { profiles: [], activeProfileId: null };
}

function safeJson(obj: unknown) {
  const seen = new WeakSet<object>();
  return JSON.stringify(obj, (_key, value) => {
    if (typeof window !== 'undefined' && value === window) return undefined;
    if (typeof document !== 'undefined' && value === document) return undefined;
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value as object)) return undefined;
      seen.add(value as object);
    }
    if (typeof value === 'function') return undefined;
    return value;
  });
}

function saveAppState(state: AppState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LS_KEY, safeJson(state));
}

function isSameDay(aISO: string, bISO: string) {
  const a = new Date(aISO);
  const b = new Date(bISO);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ============================================================================
// STYLES
// ============================================================================

const darkInputStyle: React.CSSProperties = {
  width: '100%',
  padding: 12,
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  color: '#fff',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box' as const,
};

const selectStyle: React.CSSProperties = { ...darkInputStyle, cursor: 'pointer' };

const buttonPrimary: React.CSSProperties = {
  padding: '14px 24px',
  background: 'linear-gradient(135deg, #fff 0%, #d0d0d0 100%)',
  border: 'none',
  borderRadius: 10,
  color: '#000',
  fontSize: 15,
  fontWeight: 700,
  cursor: 'pointer',
  transition: 'transform 0.2s',
};

const buttonSecondary: React.CSSProperties = {
  padding: '14px 24px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 10,
  color: '#fff',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.2s',
};

// ============================================================================
// MAIN APP COMPONENT
// ============================================================================

export default function Page() {
  const [appState, setAppState] = useState<AppState>({ profiles: [], activeProfileId: null });
  const [activeTab, setActiveTab] = useState<'today' | 'history' | 'setup' | 'data' | 'about'>('today');
  const [showProfileSelector, setShowProfileSelector] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load state on mount
  useEffect(() => {
    const state = loadAppState();
    setAppState(state);
    setIsLoaded(true);
    
    // Show profile selector if no active profile
    if (!state.activeProfileId || state.profiles.length === 0) {
      setShowProfileSelector(true);
    }
  }, []);

  // Save state on change
  useEffect(() => {
    if (isLoaded) {
      saveAppState(appState);
    }
  }, [appState, isLoaded]);

  // Get active profile
  const activeProfile = useMemo(() => {
    return appState.profiles.find(p => p.id === appState.activeProfileId) ?? null;
  }, [appState.profiles, appState.activeProfileId]);

  const setup = activeProfile?.setup ?? null;
  const history = activeProfile?.history ?? [];

  // Profile management functions
  const createProfile = useCallback((name: string) => {
    const newProfile = createDefaultProfile(name);
    setAppState(prev => ({
      profiles: [...prev.profiles, newProfile],
      activeProfileId: newProfile.id,
    }));
    setShowProfileSelector(false);
    setActiveTab('setup');
  }, []);

  const switchProfile = useCallback((profileId: string) => {
    setAppState(prev => ({
      ...prev,
      activeProfileId: profileId,
      profiles: prev.profiles.map(p => 
        p.id === profileId 
          ? { ...p, lastActiveAt: new Date().toISOString() }
          : p
      ),
    }));
    setShowProfileSelector(false);
  }, []);

  const deleteProfile = useCallback((profileId: string) => {
    setAppState(prev => {
      const newProfiles = prev.profiles.filter(p => p.id !== profileId);
      const newActiveId = prev.activeProfileId === profileId 
        ? (newProfiles[0]?.id ?? null)
        : prev.activeProfileId;
      return { profiles: newProfiles, activeProfileId: newActiveId };
    });
  }, []);

  const updateActiveProfile = useCallback((updates: Partial<UserProfile>) => {
    if (!appState.activeProfileId) return;
    setAppState(prev => ({
      ...prev,
      profiles: prev.profiles.map(p => 
        p.id === prev.activeProfileId 
          ? { ...p, ...updates, lastActiveAt: new Date().toISOString() }
          : p
      ),
    }));
  }, [appState.activeProfileId]);

  // Workout functions (updated to use profile)
  const nextDayType = useMemo(() => pickNextDayType(history), [history]);

  const [draftSetup, setDraftSetup] = useState<Setup>({
    name: '', gender: 'Male', heightIn: 70, weightLb: 180, goal: 'Hypertrophy',
    fiveRM: { bench: 135, squat: 185, deadlift: 225, ohp: 95, row: 135 },
  });

  useEffect(() => {
    if (setup) {
      setDraftSetup(setup);
    } else if (activeProfile) {
      setDraftSetup(prev => ({ ...prev, name: activeProfile.displayName }));
    }
  }, [setup, activeProfile]);

  function applyDemoData() {
    if (!activeProfile) return;
    
    const demoSetup: Setup = {
      name: activeProfile.displayName, gender: 'Male', heightIn: 70, weightLb: 180, goal: 'Hypertrophy',
      fiveRM: { bench: 225, squat: 275, deadlift: 315, ohp: 135, row: 185 },
    };
    
    const demoHistory: Session[] = [];
    const dayTypeOrder: DayType[] = ['Chest & Triceps', 'Back & Biceps', 'Legs', 'Arms'];
    
    const startingWeights: Record<LiftKey, number> = {
      bench: 155, squat: 185, deadlift: 225, ohp: 85, row: 135,
    };
    
    const totalGains: Record<LiftKey, number> = {
      bench: 12.5, squat: 15, deadlift: 15, ohp: 7.5, row: 10,
    };
    
    const workoutDays: number[] = [];
    let day = 1;
    while (day <= 56) {
      workoutDays.push(day);
      const rest = Math.random() < 0.15 ? 3 : Math.random() < 0.5 ? 2 : 1;
      day += rest;
    }
    
  workoutDays.forEach((daysAgo, workoutIndex) => {
      const dayType = dayTypeOrder[workoutIndex % 4];
      // Progress goes from 0 (oldest, 56 days ago) to 1 (most recent, 1 day ago)
      // This ensures weights INCREASE over time when viewed chronologically
      const progress = daysAgo / 56;
      
      const energy = Math.random() < 0.1 ? 2 : Math.random() < 0.3 ? 3 : Math.random() < 0.7 ? 4 : 5;
      const sleepHours = Math.floor(Math.random() * 4) + 5;
      const difficulty = energy <= 2 ? 4 : energy >= 4 ? 3 : Math.floor(Math.random() * 2) + 3;
      
     const getWeight = (lift: LiftKey): number => {
        const base = startingWeights[lift];
        // Gains increase as progress increases (closer to present = more gains)
        const gain = totalGains[lift] * (1 - progress);
        const variation = (Math.random() - 0.5) * 5;
        const energyMod = energy <= 2 ? -5 : energy >= 5 ? 2.5 : 0;
        return roundTo2_5(base + gain + variation + energyMod);
      };
      
      let workout: Exercise[] = [];
      let muscleGroups: string[] = [];
      
      if (dayType === 'Chest & Triceps') {
        workout = [
          { id: uid('ex'), name: 'Barbell Bench Press', primary: 'bench', muscleGroups: ['Chest', 'Triceps', 'Shoulders'], sets: 4, reps: '6-10', targetWeightLb: getWeight('bench') },
          { id: uid('ex'), name: 'Incline Dumbbell Press', primary: 'accessory', muscleGroups: ['Chest'], sets: 3, reps: '8-12' },
          { id: uid('ex'), name: 'Dips (Assisted if needed)', primary: 'accessory', muscleGroups: ['Chest', 'Triceps'], sets: 3, reps: '6-12' },
          { id: uid('ex'), name: 'Triceps Rope Pushdown', primary: 'accessory', muscleGroups: ['Triceps'], sets: 3, reps: '10-15' },
          { id: uid('ex'), name: 'Overhead Triceps Extension', primary: 'accessory', muscleGroups: ['Triceps'], sets: 3, reps: '10-15' },
        ];
        muscleGroups = ['Chest', 'Triceps', 'Shoulders'];
      } else if (dayType === 'Back & Biceps') {
        workout = [
          { id: uid('ex'), name: 'Barbell Row', primary: 'row', muscleGroups: ['Back', 'Biceps'], sets: 4, reps: '6-10', targetWeightLb: getWeight('row') },
          { id: uid('ex'), name: 'Pull-Ups / Lat Pulldown', primary: 'accessory', muscleGroups: ['Back'], sets: 3, reps: '6-12' },
          { id: uid('ex'), name: 'Seated Cable Row', primary: 'accessory', muscleGroups: ['Back'], sets: 3, reps: '8-12' },
          { id: uid('ex'), name: 'Face Pulls', primary: 'accessory', muscleGroups: ['Rear Delts', 'Upper Back'], sets: 3, reps: '12-15' },
          { id: uid('ex'), name: 'Dumbbell Curls', primary: 'accessory', muscleGroups: ['Biceps'], sets: 3, reps: '10-15' },
        ];
        muscleGroups = ['Back', 'Biceps'];
      } else if (dayType === 'Legs') {
        workout = [
          { id: uid('ex'), name: 'Back Squat', primary: 'squat', muscleGroups: ['Quads', 'Glutes'], sets: 4, reps: '5-8', targetWeightLb: getWeight('squat') },
          { id: uid('ex'), name: 'Romanian Deadlift', primary: 'deadlift', muscleGroups: ['Hamstrings', 'Glutes'], sets: 3, reps: '6-10', targetWeightLb: getWeight('deadlift') },
          { id: uid('ex'), name: 'Leg Press', primary: 'accessory', muscleGroups: ['Quads'], sets: 3, reps: '10-15' },
          { id: uid('ex'), name: 'Hamstring Curl', primary: 'accessory', muscleGroups: ['Hamstrings'], sets: 3, reps: '10-15' },
          { id: uid('ex'), name: 'Calf Raises', primary: 'accessory', muscleGroups: ['Calves'], sets: 3, reps: '12-20' },
        ];
        muscleGroups = ['Quads', 'Glutes', 'Hamstrings'];
      } else {
        workout = [
          { id: uid('ex'), name: 'Overhead Press', primary: 'ohp', muscleGroups: ['Shoulders', 'Triceps'], sets: 4, reps: '6-10', targetWeightLb: getWeight('ohp') },
          { id: uid('ex'), name: 'Lateral Raises', primary: 'accessory', muscleGroups: ['Shoulders'], sets: 3, reps: '12-15' },
          { id: uid('ex'), name: 'Incline Dumbbell Curls', primary: 'accessory', muscleGroups: ['Biceps'], sets: 3, reps: '10-15' },
          { id: uid('ex'), name: 'Skull Crushers', primary: 'accessory', muscleGroups: ['Triceps'], sets: 3, reps: '8-12' },
          { id: uid('ex'), name: 'Hammer Curls', primary: 'accessory', muscleGroups: ['Biceps', 'Forearms'], sets: 3, reps: '10-15' },
        ];
        muscleGroups = ['Shoulders', 'Biceps', 'Triceps'];
      }
      
      const session: Session = {
        id: uid('sess'),
        dateISO: new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString(),
        dayType,
        muscleGroups,
        energy,
        difficulty,
        sleepHours,
        workout,
        logs: workout.map(w => ({ exerciseId: w.id })),
      };
      
      demoHistory.push(session);
    });
    
    updateActiveProfile({ setup: demoSetup, history: demoHistory });
    setActiveTab('history');
  }

  function generateTodayWorkout(energy = 3, sleepHours?: number) {
    if (!setup || !activeProfile) return;
    const dayType = nextDayType;
    const template = baseWorkoutTemplate(dayType);
    const workout = template.map(ex => {
      // Primary lifts
      if (ex.primary === 'bench' || ex.primary === 'squat' || ex.primary === 'deadlift' || ex.primary === 'ohp' || ex.primary === 'row') {
        const targetWeightLb = computeTargetWeightLb({ setup, history, lift: ex.primary, dayType, currentEnergy: energy, currentSleep: sleepHours });
        return { ...ex, targetWeightLb };
      }
      // Accessory exercises
      const accessoryWeight = computeAccessoryWeightLb({
        setup,
        history,
        exerciseName: ex.name,
        currentEnergy: energy,
        currentSleep: sleepHours,
      });
      if (accessoryWeight !== undefined) {
        return { ...ex, targetWeightLb: accessoryWeight };
      }
      return ex;
    });
    const muscleGroups = Array.from(new Set(workout.flatMap(w => w.muscleGroups)));
    const session: Session = {
      id: uid('sess'), dateISO: new Date().toISOString(), dayType, muscleGroups, energy, difficulty: 3, sleepHours, workout,
      logs: workout.map(w => ({ exerciseId: w.id })),
      completed: false,
    };
    updateActiveProfile({ history: [session, ...history] });
    setActiveTab('today');
  }

  const today = history[0] && isSameDay(history[0].dateISO, new Date().toISOString()) ? history[0] : null;

  function updateToday(patch: Partial<Session>) {
    if (!today || !activeProfile) return;
    const updated = { ...today, ...patch };
    updateActiveProfile({ history: [updated, ...history.slice(1)] });
  }

  function regenerateWorkoutWeights(energy: number, difficulty: number, sleepHours?: number) {
    if (!today || !setup) return;
    const updatedWorkout = today.workout.map(ex => {
      // Primary lifts
      if (ex.primary === 'bench' || ex.primary === 'squat' || ex.primary === 'deadlift' || ex.primary === 'ohp' || ex.primary === 'row') {
        const targetWeightLb = computeTargetWeightLb({ setup, history: history.slice(1), lift: ex.primary, dayType: today.dayType, currentEnergy: energy, currentSleep: sleepHours });
        return { ...ex, targetWeightLb };
      }
      // Accessory exercises
      const accessoryWeight = computeAccessoryWeightLb({
        setup,
        history: history.slice(1),
        exerciseName: ex.name,
        currentEnergy: energy,
        currentSleep: sleepHours,
      });
      if (accessoryWeight !== undefined) {
        return { ...ex, targetWeightLb: accessoryWeight };
      }
      return ex;
    });
    updateToday({ workout: updatedWorkout, energy, difficulty, sleepHours });
  }

 function updateExerciseLog(exId: string, patch: Partial<ExerciseLog>) {
    if (!today) return;
    const logs = today.logs.map(l => (l.exerciseId === exId ? { ...l, ...patch } : l));
    updateToday({ logs });
  }

  function markWorkoutComplete(completed: boolean) {
    if (!today) return;
    updateToday({ completed });
  }

  function resetAll() {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(LS_KEY);
      window.localStorage.removeItem(OLD_LS_KEY);
    }
    setAppState({ profiles: [], activeProfileId: null });
    setShowProfileSelector(true);
  }

  // Export current profile data as JSON
  function exportProfileData() {
    if (!activeProfile) return;
    
    const exportData = {
      exportVersion: '1.0',
      exportDate: new Date().toISOString(),
      appName: 'FLEX',
      profile: {
        displayName: activeProfile.displayName,
        setup: activeProfile.setup,
        history: activeProfile.history,
        preferences: activeProfile.preferences,
      },
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flex-backup-${activeProfile.displayName.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Export all profiles
  function exportAllData() {
    const exportData = {
      exportVersion: '1.0',
      exportDate: new Date().toISOString(),
      appName: 'FLEX',
      fullBackup: true,
      profiles: appState.profiles.map(p => ({
        displayName: p.displayName,
        avatarColor: p.avatarColor,
        createdAt: p.createdAt,
        setup: p.setup,
        history: p.history,
        preferences: p.preferences,
      })),
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flex-full-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Import data from JSON file
  function handleImportData(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const importedData = JSON.parse(content);
        
        // Validate it's a FLEX export
        if (importedData.appName !== 'FLEX') {
          alert('Invalid file format. Please select a FLEX backup file.');
          return;
        }
        
        // Handle full backup (multiple profiles)
        if (importedData.fullBackup && Array.isArray(importedData.profiles)) {
          const newProfiles: UserProfile[] = importedData.profiles.map((p: Partial<UserProfile>) => ({
            id: uid('profile'),
            displayName: p.displayName || 'Imported User',
            avatarColor: p.avatarColor || AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
            createdAt: p.createdAt || new Date().toISOString(),
            lastActiveAt: new Date().toISOString(),
            setup: p.setup || null,
            history: Array.isArray(p.history) ? p.history : [],
            preferences: p.preferences || { theme: 'dark', units: 'imperial' },
          }));
          
          setAppState(prev => ({
            profiles: [...prev.profiles, ...newProfiles],
            activeProfileId: newProfiles[0]?.id || prev.activeProfileId,
          }));
          
          alert(`Successfully imported ${newProfiles.length} profile(s)!`);
        }
        // Handle single profile export
        else if (importedData.profile) {
          const p = importedData.profile;
          const newProfile: UserProfile = {
            id: uid('profile'),
            displayName: p.displayName || 'Imported User',
            avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
            createdAt: new Date().toISOString(),
            lastActiveAt: new Date().toISOString(),
            setup: p.setup || null,
            history: Array.isArray(p.history) ? p.history : [],
            preferences: p.preferences || { theme: 'dark', units: 'imperial' },
          };
          
          setAppState(prev => ({
            profiles: [...prev.profiles, newProfile],
            activeProfileId: newProfile.id,
          }));
          
          alert(`Successfully imported profile: ${newProfile.displayName}!`);
        }
        // Handle legacy format (just setup + history)
        else if (importedData.setup || importedData.history) {
          const newProfile: UserProfile = {
            id: uid('profile'),
            displayName: importedData.setup?.name || 'Imported User',
            avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
            createdAt: new Date().toISOString(),
            lastActiveAt: new Date().toISOString(),
            setup: importedData.setup || null,
            history: Array.isArray(importedData.history) ? importedData.history : [],
            preferences: { theme: 'dark', units: 'imperial' },
          };
          
          setAppState(prev => ({
            profiles: [...prev.profiles, newProfile],
            activeProfileId: newProfile.id,
          }));
          
          alert(`Successfully imported legacy data as: ${newProfile.displayName}!`);
        }
        else {
          alert('Could not parse the backup file. Please check the file format.');
        }
      } catch (err) {
        console.error('Import error:', err);
        alert('Failed to import data. Please check the file format.');
      }
      
      // Reset the file input
      event.target.value = '';
    };
    
    reader.readAsText(file);
  }

  // Merge imported workouts into current profile
  function handleMergeWorkouts(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !activeProfile) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const importedData = JSON.parse(content);
        
        let workoutsToMerge: Session[] = [];
        
        // Extract history from various formats
        if (importedData.profile?.history) {
          workoutsToMerge = importedData.profile.history;
        } else if (importedData.history) {
          workoutsToMerge = importedData.history;
        } else if (Array.isArray(importedData)) {
          workoutsToMerge = importedData;
        }
        
        if (workoutsToMerge.length === 0) {
          alert('No workout data found in the file.');
          return;
        }
        
        // Merge and deduplicate by date
        const existingDates = new Set(history.map(s => s.dateISO.split('T')[0]));
        const newWorkouts = workoutsToMerge.filter(w => {
          const dateKey = w.dateISO?.split('T')[0];
          return dateKey && !existingDates.has(dateKey);
        });
        
        if (newWorkouts.length === 0) {
          alert('All workouts in the file already exist in your history.');
          return;
        }
        
        // Assign new IDs to avoid conflicts
        const processedWorkouts = newWorkouts.map(w => ({
          ...w,
          id: uid('sess'),
          workout: w.workout.map(ex => ({ ...ex, id: uid('ex') })),
          logs: w.logs?.map(l => ({ ...l })) || [],
        }));
        
        // Merge and sort by date
        const mergedHistory = [...history, ...processedWorkouts]
          .sort((a, b) => new Date(b.dateISO).getTime() - new Date(a.dateISO).getTime());
        
        updateActiveProfile({ history: mergedHistory });
        alert(`Successfully merged ${newWorkouts.length} workout(s)!`);
        
      } catch (err) {
        console.error('Merge error:', err);
        alert('Failed to merge workouts. Please check the file format.');
      }
      
      event.target.value = '';
    };
    
    reader.readAsText(file);
  }

  // Loading state
  if (!isLoaded) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: '#fff' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>💪</div>
          <div style={{ fontSize: 18, opacity: 0.7 }}>Loading FLEX...</div>
        </div>
      </div>
    );
  }

  // Profile selector modal
  if (showProfileSelector) {
    return (
      <ProfileSelector
        profiles={appState.profiles}
        onSelectProfile={switchProfile}
        onCreateProfile={createProfile}
        onDeleteProfile={deleteProfile}
      />
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%)', color: '#f5f5f5', fontFamily: '"Outfit", "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif' }}>
      <style>{`select option { background: #1a1a1a; color: #fff; }`}</style>

      <header style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(20px)', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 32, fontWeight: 800, background: 'linear-gradient(135deg, #fff 0%, #a0a0a0 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.02em' }}>FLEX</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.6, fontWeight: 400 }}>Adaptive strength training</p>
          </div>
          
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {/* Profile Switcher Button */}
            <button
              onClick={() => setShowProfileSelector(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 16px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: activeProfile?.avatarColor || '#64c8ff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#000',
                }}
              >
                {activeProfile?.displayName?.charAt(0).toUpperCase() || '?'}
              </div>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>
                {activeProfile?.displayName || 'Select Profile'}
              </span>
              <span style={{ fontSize: 12, opacity: 0.5 }}>▼</span>
            </button>
            
            <button onClick={applyDemoData} style={{ padding: '10px 20px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}>
              Load Demo
            </button>
            <button onClick={resetAll} style={{ padding: '10px 20px', background: 'rgba(255,50,50,0.1)', border: '1px solid rgba(255,50,50,0.2)', borderRadius: 8, color: '#ff6b6b', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,50,50,0.2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,50,50,0.1)'; }}>
              Reset All
            </button>
          </div>
        </div>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', display: 'flex', gap: 4 }}>
          {(['today', 'history', 'setup', 'data', 'about'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: '12px 24px', background: activeTab === tab ? 'rgba(255,255,255,0.08)' : 'transparent', border: 'none', borderBottom: activeTab === tab ? '2px solid #fff' : '2px solid transparent', color: activeTab === tab ? '#fff' : 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {tab}
            </button>
          ))}
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        {activeTab === 'setup' && (
          <SetupView
            draftSetup={draftSetup}
            setDraftSetup={setDraftSetup}
            onSave={() => {
              updateActiveProfile({ 
                setup: draftSetup,
                displayName: draftSetup.name || activeProfile?.displayName || 'User',
              });
            }}
            onGenerate={generateTodayWorkout}
            hasSetup={!!setup}
          />
        )}
        {activeTab === 'today' && (
          <TodayView
            today={today}
            nextDayType={nextDayType}
            history={history}
            onGenerate={generateTodayWorkout}
            onUpdateLog={updateExerciseLog}
            onRegenerateWeights={regenerateWorkoutWeights}
            onMarkComplete={markWorkoutComplete}
            hasSetup={!!setup}
          />
        )}
        {activeTab === 'history' && <HistoryView history={history} />}
        {activeTab === 'data' && (
          <DataView
            profile={activeProfile}
            profileCount={appState.profiles.length}
            onExportProfile={exportProfileData}
            onExportAll={exportAllData}
            onImport={handleImportData}
            onMergeWorkouts={handleMergeWorkouts}
          />
        )}
        {activeTab === 'about' && <AboutView />}
      </main>
    </div>
  );
}

// ============================================================================
// PROFILE SELECTOR COMPONENT
// ============================================================================

interface ProfileSelectorProps {
  profiles: UserProfile[];
  onSelectProfile: (id: string) => void;
  onCreateProfile: (name: string) => void;
  onDeleteProfile: (id: string) => void;
}

function ProfileSelector({ profiles, onSelectProfile, onCreateProfile, onDeleteProfile }: ProfileSelectorProps) {
  const [isCreating, setIsCreating] = useState(profiles.length === 0);
  const [newName, setNewName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const handleCreate = () => {
    if (newName.trim()) {
      onCreateProfile(newName.trim());
      setNewName('');
      setIsCreating(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      fontFamily: '"Outfit", "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 480,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 20,
        padding: 40,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{
            margin: 0,
            fontSize: 40,
            fontWeight: 800,
            background: 'linear-gradient(135deg, #fff 0%, #a0a0a0 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            letterSpacing: '-0.02em',
          }}>
            FLEX
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: 15, opacity: 0.6 }}>
            {profiles.length === 0 ? 'Create your profile to get started' : 'Select your profile'}
          </p>
        </div>

        {/* Existing Profiles */}
        {profiles.length > 0 && !isCreating && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
            {profiles.map(profile => (
              <div
                key={profile.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: 16,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 12,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onClick={() => deleteConfirm !== profile.id && onSelectProfile(profile.id)}
                onMouseEnter={e => {
                  if (deleteConfirm !== profile.id) {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    background: profile.avatarColor,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 20,
                    fontWeight: 700,
                    color: '#000',
                    flexShrink: 0,
                  }}
                >
                  {profile.displayName.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>
                    {profile.displayName}
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.5 }}>
                    {profile.history.length} workouts • Last active {getRelativeTime(profile.lastActiveAt)}
                  </div>
                </div>
                
                {deleteConfirm === profile.id ? (
                  <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => onDeleteProfile(profile.id)}
                      style={{
                        padding: '8px 12px',
                        background: 'rgba(255,50,50,0.2)',
                        border: '1px solid rgba(255,50,50,0.3)',
                        borderRadius: 6,
                        color: '#ff6b6b',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      style={{
                        padding: '8px 12px',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 6,
                        color: '#fff',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirm(profile.id);
                    }}
                    style={{
                      padding: 8,
                      background: 'transparent',
                      border: 'none',
                      color: 'rgba(255,255,255,0.3)',
                      fontSize: 16,
                      cursor: 'pointer',
                      transition: 'color 0.2s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = '#ff6b6b'}
                    onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.3)'}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Create New Profile */}
        {isCreating ? (
          <div>
            <div style={{ marginBottom: 20 }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 8,
                opacity: 0.7,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: '#fff',
              }}>
                Your Name
              </label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                placeholder="Enter your name"
                autoFocus
                style={darkInputStyle}
              />
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={handleCreate}
                disabled={!newName.trim()}
                style={{
                  ...buttonPrimary,
                  flex: 1,
                  opacity: newName.trim() ? 1 : 0.5,
                  cursor: newName.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                Create Profile
              </button>
              {profiles.length > 0 && (
                <button
                  onClick={() => setIsCreating(false)}
                  style={buttonSecondary}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsCreating(true)}
            style={{
              ...buttonSecondary,
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 18 }}>+</span>
            Add New Profile
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// DATA VIEW COMPONENT (Import/Export)
// ============================================================================

interface DataViewProps {
  profile: UserProfile | null;
  profileCount: number;
  onExportProfile: () => void;
  onExportAll: () => void;
  onImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onMergeWorkouts: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

function DataView({ profile, profileCount, onExportProfile, onExportAll, onImport, onMergeWorkouts }: DataViewProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const mergeInputRef = React.useRef<HTMLInputElement>(null);
  
  const dataStats = useMemo(() => {
    if (!profile) return null;
    
    const totalSets = profile.history.reduce((sum, s) => 
      sum + s.workout.reduce((wSum, ex) => wSum + ex.sets, 0), 0
    );
    
    const totalVolume = profile.history.reduce((sum, s) => 
      sum + s.workout.reduce((wSum, ex) => {
        const weight = ex.targetWeightLb || 0;
        const repsMatch = ex.reps.match(/(\d+)(?:-(\d+))?/);
        const reps = repsMatch 
          ? repsMatch[2] 
            ? (parseInt(repsMatch[1]) + parseInt(repsMatch[2])) / 2 
            : parseInt(repsMatch[1])
          : 0;
        return wSum + (ex.sets * reps * weight);
      }, 0), 0
    );
    
    const firstWorkout = profile.history.length > 0 
      ? profile.history[profile.history.length - 1].dateISO 
      : null;
    
    return {
      workouts: profile.history.length,
      totalSets,
      totalVolume: Math.round(totalVolume),
      firstWorkout,
      dataSize: new Blob([JSON.stringify(profile)]).size,
    };
  }, [profile]);
  
  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24, color: '#fff' }}>Data Management</h2>
      
      {/* Data Overview Card */}
      {profile && dataStats && (
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 24, marginBottom: 24 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, color: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>📊</span> Your Data Summary
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16 }}>
            <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#64c8ff' }}>{dataStats.workouts}</div>
              <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fff', marginTop: 4 }}>Workouts</div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#6bcb77' }}>{dataStats.totalSets.toLocaleString()}</div>
              <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fff', marginTop: 4 }}>Total Sets</div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#ffd93d' }}>{Math.round(dataStats.totalVolume / 1000).toLocaleString()}k</div>
              <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fff', marginTop: 4 }}>Lbs Lifted</div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#c77dff' }}>{(dataStats.dataSize / 1024).toFixed(1)}</div>
              <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fff', marginTop: 4 }}>KB Size</div>
            </div>
          </div>
          {dataStats.firstWorkout && (
            <div style={{ marginTop: 16, padding: 12, background: 'rgba(0,0,0,0.2)', borderRadius: 8, fontSize: 13, color: '#fff', opacity: 0.7 }}>
              📅 Tracking since {formatDate(dataStats.firstWorkout)}
            </div>
          )}
        </div>
      )}
      
      {/* Export Section */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 24, marginBottom: 24 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>📤</span> Export Data
        </h3>
        <p style={{ fontSize: 14, opacity: 0.6, color: '#fff', marginBottom: 20 }}>
          Download your workout data as a JSON file for backup or transfer.
        </p>
        
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={onExportProfile}
            disabled={!profile}
            style={{
              padding: '14px 24px',
              background: profile ? 'linear-gradient(135deg, #64c8ff 0%, #4d96ff 100%)' : 'rgba(255,255,255,0.05)',
              border: 'none',
              borderRadius: 10,
              color: profile ? '#000' : 'rgba(255,255,255,0.3)',
              fontSize: 14,
              fontWeight: 700,
              cursor: profile ? 'pointer' : 'not-allowed',
              transition: 'transform 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
            onMouseEnter={e => profile && (e.currentTarget.style.transform = 'scale(1.02)')}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            <span>👤</span> Export Current Profile
          </button>
          
          {profileCount > 1 && (
            <button
              onClick={onExportAll}
              style={{
                padding: '14px 24px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10,
                color: '#fff',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
              }}
            >
              <span>👥</span> Export All Profiles ({profileCount})
            </button>
          )}
        </div>
      </div>
      
      {/* Import Section */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 24, marginBottom: 24 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>📥</span> Import Data
        </h3>
        <p style={{ fontSize: 14, opacity: 0.6, color: '#fff', marginBottom: 20 }}>
          Restore from a backup or import data from another device.
        </p>
        
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={onImport}
            style={{ display: 'none' }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '14px 24px',
              background: 'linear-gradient(135deg, #6bcb77 0%, #4ade80 100%)',
              border: 'none',
              borderRadius: 10,
              color: '#000',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'transform 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            <span>📁</span> Import Backup File
          </button>
          
          <input
            ref={mergeInputRef}
            type="file"
            accept=".json"
            onChange={onMergeWorkouts}
            style={{ display: 'none' }}
          />
          <button
            onClick={() => mergeInputRef.current?.click()}
            disabled={!profile}
            style={{
              padding: '14px 24px',
              background: profile ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)',
              border: profile ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(255,255,255,0.05)',
              borderRadius: 10,
              color: profile ? '#fff' : 'rgba(255,255,255,0.3)',
              fontSize: 14,
              fontWeight: 600,
              cursor: profile ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
            onMouseEnter={e => {
              if (profile) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
              }
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = profile ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)';
              e.currentTarget.style.borderColor = profile ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)';
            }}
          >
            <span>🔀</span> Merge Workouts into Profile
          </button>
        </div>
        
        <div style={{ marginTop: 16, padding: 16, background: 'rgba(255,200,100,0.08)', border: '1px solid rgba(255,200,100,0.2)', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span>💡</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#ffcc66' }}>Import Options</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, opacity: 0.8, color: '#fff', lineHeight: 1.8 }}>
            <li><strong>Import Backup</strong> — Creates new profile(s) from the backup file</li>
            <li><strong>Merge Workouts</strong> — Adds workouts from the file to your current profile (skips duplicates)</li>
          </ul>
        </div>
      </div>
      
      {/* Data Format Info */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 24 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, color: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>📋</span> Supported Formats
        </h3>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ padding: 16, background: 'rgba(0,0,0,0.2)', borderRadius: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#64c8ff', marginBottom: 6 }}>FLEX Backup (.json)</div>
            <div style={{ fontSize: 13, opacity: 0.7, color: '#fff' }}>
              Full backup files exported from FLEX, including profile settings and workout history.
            </div>
          </div>
          <div style={{ padding: 16, background: 'rgba(0,0,0,0.2)', borderRadius: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#6bcb77', marginBottom: 6 }}>Legacy Format (.json)</div>
            <div style={{ fontSize: 13, opacity: 0.7, color: '#fff' }}>
              Older FLEX data format with setup and history fields — automatically converted on import.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// VIEW COMPONENTS (Same as before, with minor updates)
// ============================================================================

function AboutView() {
  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 32 }}>
        <h2 style={{ margin: '0 0 24px', fontSize: 28, fontWeight: 700, color: '#fff' }}>About FLEX</h2>
        
        <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.9, marginBottom: 20, color: '#fff' }}>
          FLEX was born from a passion for fitness and a curiosity about what&apos;s possible when 
          you combine adaptive programming with modern technology. As someone who loves both 
          lifting and building products, I wanted to create something that genuinely helps 
          people train smarter—not just harder.
        </p>
        
        <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.9, marginBottom: 24, color: '#fff' }}>
          This project is also my way of developing skills in AI and product management by 
          building something real and usable. Every feature represents a learning opportunity, 
          from the adaptive weight calculations to the progress visualization.
        </p>

        <div style={{ background: 'rgba(255,200,100,0.08)', border: '1px solid rgba(255,200,100,0.2)', borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 20 }}>🚧</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#ffcc66', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Work in Progress</span>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.6, opacity: 0.8, margin: 0, color: '#fff' }}>
            FLEX is a prototype and actively evolving. Features may change, and I&apos;m always 
            looking to improve the experience. Feedback is welcome!
          </p>
        </div>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 20 }}>
          <p style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px', color: '#fff' }}>
            Built by Paul Ancin
          </p>
          <a 
            href="https://www.linkedin.com/in/paul-ancin/" 
            target="_blank" 
            rel="noopener noreferrer"
            style={{ 
              fontSize: 13, 
              color: '#64c8ff', 
              textDecoration: 'none',
              opacity: 0.8,
              transition: 'opacity 0.2s'
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '1'}
            onMouseLeave={e => e.currentTarget.style.opacity = '0.8'}
          >
            Connect on LinkedIn →
          </a>
          <p style={{ fontSize: 13, opacity: 0.5, margin: '8px 0 0', color: '#fff' }}>
            React & TypeScript
          </p>
        </div>
      </div>
    </div>
  );
}

interface SetupViewProps {
  draftSetup: Setup;
  setDraftSetup: (setup: Setup) => void;
  onSave: () => void;
  onGenerate: (energy?: number, sleepHours?: number) => void;
  hasSetup: boolean;
}

function SetupView({ draftSetup, setDraftSetup, onSave, onGenerate, hasSetup }: SetupViewProps) {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 32 }}>
        <h2 style={{ margin: '0 0 24px', fontSize: 24, fontWeight: 700, color: '#fff' }}>Profile Setup</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 32 }}>
          <InputField label="Name" value={draftSetup.name ?? ''} onChange={(v) => setDraftSetup({ ...draftSetup, name: v })} />
          <InputField label="Gender" value={draftSetup.gender} onChange={(v) => setDraftSetup({ ...draftSetup, gender: v })} />
          <InputField label="Height (in)" type="number" value={draftSetup.heightIn} onChange={(v) => setDraftSetup({ ...draftSetup, heightIn: Number(v) })} />
          <InputField label="Weight (lb)" type="number" value={draftSetup.weightLb} onChange={(v) => setDraftSetup({ ...draftSetup, weightLb: Number(v) })} />
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fff' }}>Goal</label>
            <select value={draftSetup.goal} onChange={(e) => setDraftSetup({ ...draftSetup, goal: e.target.value as Setup['goal'] })} style={selectStyle}>
              <option value="Hypertrophy">Hypertrophy</option>
              <option value="Strength">Strength</option>
              <option value="Health">Health</option>
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, opacity: 0.9, color: '#fff' }}>5-Rep Max (lbs)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16 }}>
            {(['bench', 'squat', 'deadlift', 'ohp', 'row'] as LiftKey[]).map(k => (
              <InputField key={k} label={k.toUpperCase()} type="number" value={draftSetup.fiveRM[k]} onChange={(v) => setDraftSetup({ ...draftSetup, fiveRM: { ...draftSetup.fiveRM, [k]: Number(v) } })} />
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
          <button onClick={onSave} style={{ ...buttonPrimary, flex: 1 }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'} onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
            Save Profile
          </button>
          <button onClick={() => onGenerate()} disabled={!hasSetup} style={{ flex: 1, padding: '14px 24px', background: hasSetup ? 'rgba(100,200,255,0.2)' : 'rgba(255,255,255,0.05)', border: hasSetup ? '1px solid rgba(100,200,255,0.4)' : '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: hasSetup ? '#64c8ff' : 'rgba(255,255,255,0.3)', fontSize: 15, fontWeight: 700, cursor: hasSetup ? 'pointer' : 'not-allowed', transition: 'all 0.2s' }}>
            Generate Today&apos;s Workout
          </button>
        </div>
      </div>
    </div>
  );
}

interface TodayViewProps {
  today: Session | null;
  nextDayType: DayType;
  history: Session[];
  onGenerate: (energy?: number, sleepHours?: number) => void;
  onUpdateLog: (exId: string, patch: Partial<ExerciseLog>) => void;
  onRegenerateWeights: (energy: number, difficulty: number, sleepHours?: number) => void;
  onMarkComplete: (completed: boolean) => void;
  hasSetup: boolean;
}

function TodayView({ today, nextDayType, history, onGenerate, onUpdateLog, onRegenerateWeights, onMarkComplete, hasSetup }: TodayViewProps) {
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);

  const completionStats = useMemo(() => {
    if (!today) return { logged: 0, total: 0, percentage: 0 };
    const total = today.workout.length;
    const logged = today.logs.filter(log => 
      log.actualWeightLb !== undefined || log.actualReps !== undefined || log.rpe !== undefined
    ).length;
    return { logged, total, percentage: Math.round((logged / total) * 100) };
  }, [today]);

  const isCompleted = today?.completed || false;

  if (!today) {
    return (
      <div style={{ maxWidth: 600, margin: '120px auto', textAlign: 'center' }}>
        <div style={{ width: 80, height: 80, margin: '0 auto 24px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>💪</div>
        <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12, color: '#fff' }}>No Workout Yet</h2>
        <p style={{ opacity: 0.6, marginBottom: 32, fontSize: 15, color: '#fff' }}>{hasSetup ? `Ready to start a ${nextDayType} workout?` : 'Complete your profile setup first, then generate your workout.'}</p>
        <button onClick={() => onGenerate()} disabled={!hasSetup} style={{ padding: '16px 40px', background: hasSetup ? 'linear-gradient(135deg, #fff 0%, #d0d0d0 100%)' : 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 12, color: hasSetup ? '#000' : 'rgba(255,255,255,0.3)', fontSize: 16, fontWeight: 700, cursor: hasSetup ? 'pointer' : 'not-allowed', transition: 'transform 0.2s' }}
          onMouseEnter={e => hasSetup && (e.currentTarget.style.transform = 'scale(1.05)')} onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
          Generate Workout
        </button>
      </div>
    );
  }
 return (
    <div>
      <div style={{ background: 'linear-gradient(135deg, rgba(100,200,255,0.1) 0%, rgba(150,100,255,0.1) 100%)', border: '1px solid rgba(100,200,255,0.2)', borderRadius: 16, padding: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h2 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: '#fff' }}>{today.dayType}</h2>
              {isCompleted && (
                <span style={{ 
                  padding: '6px 12px', 
                  background: 'rgba(107,203,119,0.2)', 
                  border: '1px solid rgba(107,203,119,0.4)',
                  borderRadius: 8, 
                  fontSize: 12, 
                  fontWeight: 700, 
                  color: '#6bcb77',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  ✓ Completed
                </span>
              )}
            </div>
            <p style={{ margin: '6px 0 0', opacity: 0.7, fontSize: 14, color: '#fff' }}>{today.muscleGroups.join(' • ')}</p>
          </div>
          <div style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#fff' }}>~60 min</div>
        </div>
        
        {/* Progress indicator */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, opacity: 0.7, color: '#fff' }}>Logging Progress</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: completionStats.percentage === 100 ? '#6bcb77' : '#64c8ff' }}>
              {completionStats.logged}/{completionStats.total} exercises logged
            </span>
          </div>
          <div style={{ height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ 
              height: '100%', 
              width: `${completionStats.percentage}%`, 
              background: completionStats.percentage === 100 
                ? 'linear-gradient(90deg, #6bcb77, #4ade80)' 
                : 'linear-gradient(90deg, #64c8ff, #4d96ff)',
              borderRadius: 3,
              transition: 'width 0.3s ease'
            }} />
          </div>
        </div>
        
        {history.length > 1 && (
          <div style={{ padding: 16, background: 'rgba(0,0,0,0.2)', borderRadius: 10, fontSize: 13, lineHeight: 1.6, opacity: 0.9, color: '#fff' }}>
            Last workout: <strong>{history[1].dayType}</strong> ({Math.max(1, Math.round((Date.now() - new Date(history[1].dateISO).getTime()) / (1000 * 60 * 60 * 24)))} days ago) — Difficulty {history[1].difficulty}/5, Energy {history[1].energy}/5
          </div>
        )}
      </div>
      <div style={{ background: 'rgba(255,200,100,0.05)', border: '1px solid rgba(255,200,100,0.15)', borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 13, fontWeight: 600, color: '#ffcc66' }}>
          <span>⚡</span><span>Adjust these to automatically update your workout weights</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <MetricCard label="Energy Level" value={today.energy} max={5} onChange={(v: number) => onRegenerateWeights(v, today.difficulty, today.sleepHours)} />
          <MetricCard label="Difficulty" value={today.difficulty} max={5} onChange={(v: number) => onRegenerateWeights(today.energy, v, today.sleepHours)} />
          <MetricCard label="Sleep (hours)" value={today.sleepHours ?? 0} max={12} onChange={(v: number) => onRegenerateWeights(today.energy, today.difficulty, v || undefined)} />
       <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {today.workout.map((ex: Exercise) => (
  <ExerciseCard
    key={ex.id}
    exercise={ex}
    log={today.logs.find((l: ExerciseLog) => l.exerciseId === ex.id)}
    onUpdateLog={(patch: Partial<ExerciseLog>) => onUpdateLog(ex.id, patch)}
  />
))}

      </div>

      {/* Save/Complete Workout Section */}
      <div style={{ 
        marginTop: 32, 
        padding: 24, 
        background: isCompleted 
          ? 'rgba(107,203,119,0.08)' 
          : 'rgba(100,200,255,0.05)', 
        border: isCompleted 
          ? '1px solid rgba(107,203,119,0.2)' 
          : '1px solid rgba(100,200,255,0.15)', 
        borderRadius: 16 
      }}>
        {showSaveConfirm ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#6bcb77' }}>Workout Saved!</h3>
            <p style={{ margin: '0 0 20px', fontSize: 14, opacity: 0.7, color: '#fff' }}>
              Your workout has been recorded and saved to your history.
            </p>
            <button
              onClick={() => setShowSaveConfirm(false)}
              style={{
                padding: '12px 24px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10,
                color: '#fff',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Continue Editing
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <span style={{ fontSize: 24 }}>{isCompleted ? '✅' : '💾'}</span>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#fff' }}>
                  {isCompleted ? 'Workout Completed' : 'Save Your Workout'}
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.7, color: '#fff' }}>
                  {isCompleted 
                    ? 'This workout has been saved to your history. You can still edit the details.' 
                    : 'Your data is auto-saved as you type. Mark as complete when finished.'}
                </p>
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {!isCompleted ? (
                <button
                  onClick={() => {
                    onMarkComplete(true);
                    setShowSaveConfirm(true);
                  }}
                  style={{
                    padding: '14px 28px',
                    background: 'linear-gradient(135deg, #6bcb77 0%, #4ade80 100%)',
                    border: 'none',
                    borderRadius: 10,
                    color: '#000',
                    fontSize: 15,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span>✓</span> Mark Workout Complete
                </button>
              ) : (
                <button
                  onClick={() => onMarkComplete(false)}
                  style={{
                    padding: '14px 28px',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 10,
                    color: '#fff',
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span>↩</span> Mark as Incomplete
                </button>
              )}
              
              <div style={{ 
                padding: '14px 20px', 
                background: 'rgba(0,0,0,0.2)', 
                borderRadius: 10, 
                fontSize: 13, 
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                opacity: 0.8,
              }}>
                <span>💡</span>
                <span>Data auto-saves to localStorage</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );

function extractProgressData(history: Session[], selectedDayType: DayType | 'all', selectedLift: LiftKey | 'all') {
  const data: Array<{ date: string; dateISO: string; dayType: DayType; lift: LiftKey; liftName: string; weight: number; energy: number; difficulty: number; }> = [];
  const filteredHistory = selectedDayType === 'all' ? history : history.filter(s => s.dayType === selectedDayType);
  filteredHistory.forEach(session => {
    session.workout.forEach(exercise => {
      if (exercise.primary !== 'accessory' && exercise.targetWeightLb) {
        const lift = exercise.primary as LiftKey;
        if (selectedLift === 'all' || lift === selectedLift) {
          data.push({ date: formatDate(session.dateISO), dateISO: session.dateISO, dayType: session.dayType, lift, liftName: exercise.name, weight: exercise.targetWeightLb, energy: session.energy, difficulty: session.difficulty });
        }
      }
    });
  });
  return data.sort((a, b) => new Date(a.dateISO).getTime() - new Date(b.dateISO).getTime());
}

// ============================================================================
// PROGRESS DASHBOARD COMPONENTS
// ============================================================================

const LIFT_COLORS: Record<LiftKey, string> = { bench: '#64c8ff', squat: '#ff6b9d', deadlift: '#ffd93d', ohp: '#95e1d3', row: '#c77dff' };
const LIFT_NAMES: Record<LiftKey, string> = { bench: 'Bench Press', squat: 'Squat', deadlift: 'Deadlift', ohp: 'Overhead Press', row: 'Barbell Row' };

const MUSCLE_GROUP_COLORS: Record<string, string> = {
  'Chest': '#ff6b9d',
  'Back': '#64c8ff',
  'Shoulders': '#c77dff',
  'Biceps': '#ffd93d',
  'Triceps': '#ff8c42',
  'Quads': '#6bcb77',
  'Hamstrings': '#4d96ff',
  'Glutes': '#a8e6cf',
  'Calves': '#95e1d3',
  'Rear Delts': '#c77dff',
  'Upper Back': '#64c8ff',
  'Forearms': '#ffd93d',
};

// Streak & Consistency Stats Card
function StatsOverview({ history }: { history: Session[] }) {
  const stats = useMemo(() => calculateStreakStats(history), [history]);
  
  const statItems = [
    { label: 'Current Streak', value: stats.currentStreak, suffix: 'workouts', icon: '🔥', color: '#ff8c42' },
    { label: 'Longest Streak', value: stats.longestStreak, suffix: 'workouts', icon: '🏆', color: '#ffd93d' },
    { label: 'This Week', value: stats.workoutsThisWeek, suffix: 'workouts', icon: '📅', color: '#64c8ff' },
    { label: 'This Month', value: stats.workoutsThisMonth, suffix: 'workouts', icon: '📆', color: '#6bcb77' },
    { label: 'Weekly Avg', value: stats.avgWorkoutsPerWeek, suffix: '/week', icon: '📊', color: '#c77dff' },
    { label: 'Total', value: stats.totalWorkouts, suffix: 'workouts', icon: '💪', color: '#95e1d3' },
  ];
  
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 24, marginBottom: 24 }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, color: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span>📈</span> Consistency Stats
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16 }}>
        {statItems.map(item => (
          <div key={item.label} style={{ 
            background: 'rgba(0,0,0,0.2)', 
            borderRadius: 12, 
            padding: 16, 
            textAlign: 'center',
            border: `1px solid ${item.color}22`,
          }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>{item.icon}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: item.color }}>{item.value}</div>
            <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fff', marginTop: 4 }}>
              {item.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Personal Records Card
function PersonalRecordsCard({ history }: { history: Session[] }) {
  const prs = useMemo(() => findPersonalRecords(history), [history]);
  const hasPRs = Object.values(prs).some(pr => pr !== null);
  
  if (!hasPRs) return null;
  
  return (
    <div style={{ background: 'linear-gradient(135deg, rgba(255,215,0,0.1) 0%, rgba(255,140,0,0.1) 100%)', border: '1px solid rgba(255,215,0,0.2)', borderRadius: 16, padding: 24, marginBottom: 24 }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, color: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span>🏆</span> Personal Records
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        {(Object.entries(prs) as [LiftKey, { weight: number; date: string } | null][])
          .filter(([, pr]) => pr !== null)
          .map(([lift, pr]) => (
            <div key={lift} style={{ 
              background: 'rgba(0,0,0,0.3)', 
              borderRadius: 12, 
              padding: 16,
              borderLeft: `4px solid ${LIFT_COLORS[lift]}`,
            }}>
              <div style={{ fontSize: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fff', marginBottom: 8 }}>
                {LIFT_NAMES[lift]}
              </div>
              <div style={{ fontSize: 32, fontWeight: 800, color: LIFT_COLORS[lift] }}>
                {pr!.weight} <span style={{ fontSize: 16, fontWeight: 600, opacity: 0.7 }}>lbs</span>
              </div>
              <div style={{ fontSize: 12, opacity: 0.5, color: '#fff', marginTop: 6 }}>
                {formatDateShort(pr!.date)}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

// Muscle Group Heatmap
function MuscleGroupHeatmap({ history }: { history: Session[] }) {
  const [timeframe, setTimeframe] = useState<7 | 14 | 30>(7);
  const volumes = useMemo(() => calculateMuscleGroupVolume(history, timeframe), [history, timeframe]);
  
  const sortedMuscles = Object.entries(volumes)
    .sort(([, a], [, b]) => b - a);
  
  const maxVolume = Math.max(...Object.values(volumes), 1);
  
  if (sortedMuscles.length === 0) {
    return (
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 24, marginBottom: 24 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, color: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>🎯</span> Muscle Group Volume
        </h3>
        <p style={{ opacity: 0.6, color: '#fff' }}>No workout data in selected timeframe</p>
      </div>
    );
  }
  
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 24, marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 10, margin: 0 }}>
          <span>🎯</span> Muscle Group Volume
        </h3>
        <div style={{ display: 'flex', gap: 8 }}>
          {([7, 14, 30] as const).map(days => (
            <button
              key={days}
              onClick={() => setTimeframe(days)}
              style={{
                padding: '6px 12px',
                background: timeframe === days ? 'rgba(100,200,255,0.2)' : 'rgba(255,255,255,0.05)',
                border: timeframe === days ? '1px solid rgba(100,200,255,0.4)' : '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6,
                color: timeframe === days ? '#64c8ff' : '#fff',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {days}d
            </button>
          ))}
        </div>
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {sortedMuscles.map(([muscle, volume]) => {
          const percentage = (volume / maxVolume) * 100;
          const color = MUSCLE_GROUP_COLORS[muscle] || '#64c8ff';
          
          return (
            <div key={muscle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{muscle}</span>
                <span style={{ fontSize: 13, opacity: 0.6, color: '#fff' }}>{Math.round(volume / 1000)}k lbs</span>
              </div>
              <div style={{ 
                height: 24, 
                background: 'rgba(255,255,255,0.05)', 
                borderRadius: 6,
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${percentage}%`,
                  background: `linear-gradient(90deg, ${color}88, ${color})`,
                  borderRadius: 6,
                  transition: 'width 0.3s ease',
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Weekly Volume Trends Chart
function VolumeTrendsChart({ history }: { history: Session[] }) {
  const volumeData = useMemo(() => calculateVolumeTrends(history, 8), [history]);
  
  if (volumeData.length < 2) {
    return (
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 24, marginBottom: 24 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, color: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>📊</span> Weekly Volume Trends
        </h3>
        <p style={{ opacity: 0.6, color: '#fff' }}>Need at least 2 weeks of data to show trends</p>
      </div>
    );
  }
  
  const chartWidth = 700;
  const chartHeight = 250;
  const padding = { top: 30, right: 30, bottom: 50, left: 60 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;
  
  const maxVolume = Math.max(...volumeData.map(d => d.volume));
  const minVolume = Math.min(...volumeData.map(d => d.volume));
  const volumeRange = maxVolume - minVolume || 1;
  
  const xScale = (i: number) => padding.left + (i / (volumeData.length - 1)) * innerWidth;
  const yScale = (v: number) => chartHeight - padding.bottom - ((v - minVolume) / volumeRange) * innerHeight;
  
  // Create path
  const linePath = volumeData
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(d.volume)}`)
    .join(' ');
  
  // Create area path
  const areaPath = `${linePath} L ${xScale(volumeData.length - 1)} ${chartHeight - padding.bottom} L ${padding.left} ${chartHeight - padding.bottom} Z`;
  
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 24, marginBottom: 24 }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, color: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span>📊</span> Weekly Volume Trends
      </h3>
      <div style={{ overflowX: 'auto' }}>
        <svg width={chartWidth} height={chartHeight} style={{ display: 'block' }}>
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map(pct => {
            const y = chartHeight - padding.bottom - pct * innerHeight;
            const value = minVolume + pct * volumeRange;
            return (
              <g key={pct}>
                <line x1={padding.left} y1={y} x2={chartWidth - padding.right} y2={y} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
                <text x={padding.left - 10} y={y + 4} fill="rgba(255,255,255,0.5)" fontSize={11} textAnchor="end">
                  {Math.round(value / 1000)}k
                </text>
              </g>
            );
          })}
          
          {/* Area fill */}
          <path d={areaPath} fill="url(#volumeGradient)" />
          
          {/* Line */}
          <path d={linePath} fill="none" stroke="#6bcb77" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          
          {/* Data points */}
          {volumeData.map((d, i) => (
            <g key={i}>
              <circle cx={xScale(i)} cy={yScale(d.volume)} r={6} fill="#6bcb77" stroke="#1a1a1a" strokeWidth={2} />
             <text x={xScale(i)} y={chartHeight - padding.bottom + 20} fill="rgba(255,255,255,0.5)" fontSize={10} textAnchor="middle">
                {(() => {
                  const match = d.week.match(/W(\d+)\s+(\d+)/);
                  if (!match) return d.week;
                  const weekNum = parseInt(match[1]);
                  const year = match[2];
                  // Approximate month from week number (week 1-4 = Jan, 5-8 = Feb, etc.)
                  const month = Math.min(12, Math.ceil(weekNum / 4.33));
                  return `${month.toString().padStart(2, '0')}/${year}`;
                })()}
              </text>
              <text x={xScale(i)} y={chartHeight - padding.bottom + 32} fill="rgba(255,255,255,0.4)" fontSize={9} textAnchor="middle">
                {d.workouts} wkts
              </text>
              <title>{`${d.week}: ${Math.round(d.volume).toLocaleString()} lbs total volume (${d.workouts} workouts)`}</title>
            </g>
          ))}
          
          {/* Gradient definition */}
          <defs>
            <linearGradient id="volumeGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#6bcb77" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#6bcb77" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          
          {/* Y-axis label */}
          <text x={15} y={padding.top + innerHeight / 2} fill="rgba(255,255,255,0.6)" fontSize={12} fontWeight={600} textAnchor="middle" transform={`rotate(-90, 15, ${padding.top + innerHeight / 2})`}>
            Volume (lbs)
          </text>
        </svg>
      </div>
      
      {/* Summary stats */}
      <div style={{ display: 'flex', gap: 24, marginTop: 20, justifyContent: 'center', flexWrap: 'wrap' }}>
        {(() => {
          const firstWeek = volumeData[0].volume;
          const lastWeek = volumeData[volumeData.length - 1].volume;
          const change = lastWeek - firstWeek;
          const percentChange = ((change / firstWeek) * 100).toFixed(1);
          const avgVolume = volumeData.reduce((sum, d) => sum + d.volume, 0) / volumeData.length;
          
          return (
            <>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fff', marginBottom: 4 }}>Trend</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: change >= 0 ? '#4ade80' : '#ff6b6b' }}>
                  {change >= 0 ? '↑' : '↓'} {Math.abs(Number(percentChange))}%
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fff', marginBottom: 4 }}>Avg Weekly</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{Math.round(avgVolume / 1000)}k lbs</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fff', marginBottom: 4 }}>Peak Week</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#6bcb77' }}>{Math.round(maxVolume / 1000)}k lbs</div>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}

// Weight Progress Chart (improved version of original)
function ProgressChart({ data }: { data: ReturnType<typeof extractProgressData> }) {
  if (data.length === 0) {
    return (
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 40, textAlign: 'center' }}>
        <p style={{ opacity: 0.6, color: '#fff' }}>No data available for selected filters</p>
      </div>
    );
  }
  
  const liftGroups: Record<LiftKey, typeof data> = { bench: [], squat: [], deadlift: [], ohp: [], row: [] };
  data.forEach(point => { liftGroups[point.lift].push(point); });
  
  const chartWidth = 800, chartHeight = 400;
  const padding = { top: 40, right: 60, bottom: 60, left: 60 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;
  
  const allWeights = data.map(d => d.weight);
  const minWeight = Math.floor(Math.min(...allWeights) / 10) * 10 - 10;
  const maxWeight = Math.ceil(Math.max(...allWeights) / 10) * 10 + 10;
  
  const xScale = (index: number, total: number) => padding.left + (index / Math.max(1, total - 1)) * innerWidth;
  const yScale = (weight: number) => chartHeight - padding.bottom - ((weight - minWeight) / (maxWeight - minWeight)) * innerHeight;
  
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 24, overflow: 'hidden', marginBottom: 24 }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, color: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span>💪</span> Lift Progress Over Time
      </h3>
      <div style={{ overflowX: 'auto' }}>
        <svg width={chartWidth} height={chartHeight} style={{ display: 'block' }}>
          {[0, 1, 2, 3, 4].map(i => {
            const weight = minWeight + (i / 4) * (maxWeight - minWeight);
            const y = yScale(weight);
            return (
              <g key={i}>
                <line x1={padding.left} y1={y} x2={chartWidth - padding.right} y2={y} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
                <text x={padding.left - 10} y={y + 4} fill="rgba(255,255,255,0.5)" fontSize={12} textAnchor="end">{Math.round(weight)}</text>
              </g>
            );
          })}
          <line x1={padding.left} y1={chartHeight - padding.bottom} x2={chartWidth - padding.right} y2={chartHeight - padding.bottom} stroke="rgba(255,255,255,0.2)" strokeWidth={2} />
          <line x1={padding.left} y1={padding.top} x2={padding.left} y2={chartHeight - padding.bottom} stroke="rgba(255,255,255,0.2)" strokeWidth={2} />
          <text x={20} y={padding.top + innerHeight / 2} fill="rgba(255,255,255,0.6)" fontSize={14} fontWeight={600} textAnchor="middle" transform={`rotate(-90, 20, ${padding.top + innerHeight / 2})`}>Weight (lbs)</text>
          
          {Object.entries(liftGroups).map(([lift, points]) => {
            if (points.length === 0) return null;
            const pathData = points.map((point, i) => {
              const x = xScale(data.indexOf(point), data.length);
              const y = yScale(point.weight);
              return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
            }).join(' ');
            
            return (
              <g key={lift}>
                <path d={pathData} fill="none" stroke={LIFT_COLORS[lift as LiftKey]} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                {points.map((point, i) => {
                  const x = xScale(data.indexOf(point), data.length);
                  const y = yScale(point.weight);
                  return (
                    <g key={i}>
                      <circle cx={x} cy={y} r={5} fill={LIFT_COLORS[lift as LiftKey]} stroke="rgba(0,0,0,0.5)" strokeWidth={2} />
                      <title>{`${point.liftName}: ${point.weight} lbs\n${point.date}\nEnergy: ${point.energy}/5`}</title>
                    </g>
                  );
                })}
              </g>
            );
          })}
          
          {data.map((point, i) => {
            if (i % Math.max(1, Math.floor(data.length / 6)) === 0 || i === data.length - 1) {
              const x = xScale(i, data.length);
              return (
                <text key={i} x={x} y={chartHeight - padding.bottom + 20} fill="rgba(255,255,255,0.5)" fontSize={11} textAnchor="middle" transform={`rotate(-45, ${x}, ${chartHeight - padding.bottom + 20})`}>
                  {point.date}
                </text>
              );
            }
            return null;
          })}
        </svg>
      </div>
      
      {/* Legend */}
      <div style={{ display: 'flex', gap: 20, marginTop: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
        {Object.entries(liftGroups)
          .filter(([, points]) => points.length > 0)
          .map(([lift, points]) => (
            <div key={lift} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 16, height: 16, borderRadius: '50%', background: LIFT_COLORS[lift as LiftKey] }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{LIFT_NAMES[lift as LiftKey]} ({points.length})</span>
            </div>
          ))}
      </div>
      
      {/* Gains summary */}
      <div style={{ marginTop: 24, padding: 16, background: 'rgba(0,0,0,0.2)', borderRadius: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
        {Object.entries(liftGroups)
          .filter(([, points]) => points.length > 0)
          .map(([lift, points]) => {
            const weights = points.map(p => p.weight);
            const firstWeight = weights[0];
            const lastWeight = weights[weights.length - 1];
            const change = lastWeight - firstWeight;
            const percentChange = ((change / firstWeight) * 100).toFixed(1);
            
            return (
              <div key={lift} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fff' }}>
                  {LIFT_NAMES[lift as LiftKey]}
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: change >= 0 ? '#4ade80' : '#ff6b6b' }}>
                  {change >= 0 ? '+' : ''}{change} lbs
                </div>
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2, color: '#fff' }}>
                  {change >= 0 ? '+' : ''}{percentChange}% gain
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

// Main History/Progress View
function HistoryView({ history }: { history: Session[] }) {
  const [activeSubTab, setActiveSubTab] = useState<'dashboard' | 'sessions'>('dashboard');
  const [selectedDayType, setSelectedDayType] = useState<DayType | 'all'>('all');
  const [selectedLift, setSelectedLift] = useState<LiftKey | 'all'>('all');
  
  if (history.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '120px 0' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12, color: '#fff' }}>No History Yet</h2>
        <p style={{ opacity: 0.6, color: '#fff' }}>Your workout history and progress will appear here once you start tracking.</p>
      </div>
    );
  }
  
  const dayTypes: DayType[] = Array.from(new Set(history.map(s => s.dayType)));
  const progressData = extractProgressData(history, selectedDayType, selectedLift);
  
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#fff' }}>Progress & History</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setActiveSubTab('dashboard')}
            style={{
              padding: '10px 20px',
              background: activeSubTab === 'dashboard' ? 'rgba(100,200,255,0.2)' : 'rgba(255,255,255,0.05)',
              border: activeSubTab === 'dashboard' ? '1px solid rgba(100,200,255,0.4)' : '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              color: activeSubTab === 'dashboard' ? '#64c8ff' : '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            📊 Dashboard
          </button>
          <button
            onClick={() => setActiveSubTab('sessions')}
            style={{
              padding: '10px 20px',
              background: activeSubTab === 'sessions' ? 'rgba(100,200,255,0.2)' : 'rgba(255,255,255,0.05)',
              border: activeSubTab === 'sessions' ? '1px solid rgba(100,200,255,0.4)' : '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              color: activeSubTab === 'sessions' ? '#64c8ff' : '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            📋 Sessions
          </button>
        </div>
      </div>
      
      {activeSubTab === 'dashboard' ? (
        <>
          {/* Stats Overview */}
          <StatsOverview history={history} />
          
          {/* Personal Records */}
          <PersonalRecordsCard history={history} />
          
          {/* Two column layout for smaller charts */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 24, marginBottom: 24 }}>
            <MuscleGroupHeatmap history={history} />
            <VolumeTrendsChart history={history} />
          </div>
          
          {/* Filters for lift progress */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fff' }}>
                Workout Type
              </label>
              <select value={selectedDayType} onChange={(e) => setSelectedDayType(e.target.value as DayType | 'all')} style={selectStyle}>
                <option value="all">All Workouts</option>
                {dayTypes.map(dt => (<option key={dt} value={dt}>{dt}</option>))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fff' }}>
                Primary Lift
              </label>
              <select value={selectedLift} onChange={(e) => setSelectedLift(e.target.value as LiftKey | 'all')} style={selectStyle}>
                <option value="all">All Lifts</option>
                <option value="bench">Bench Press</option>
                <option value="squat">Squat</option>
                <option value="deadlift">Deadlift</option>
                <option value="ohp">Overhead Press</option>
                <option value="row">Barbell Row</option>
              </select>
            </div>
          </div>
          
          {/* Lift Progress Chart */}
          {progressData.length > 0 && <ProgressChart data={progressData} />}
        </>
      ) : (
        <>
          {/* Session filters */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fff' }}>
                Workout Type
              </label>
              <select value={selectedDayType} onChange={(e) => setSelectedDayType(e.target.value as DayType | 'all')} style={selectStyle}>
                <option value="all">All Workouts</option>
                {dayTypes.map(dt => (<option key={dt} value={dt}>{dt}</option>))}
              </select>
            </div>
          </div>
          
          {/* Session list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {history
              .filter(s => selectedDayType === 'all' || s.dayType === selectedDayType)
              .map((session, idx) => (
                <HistoryCard key={session.id} session={session} isRecent={idx === 0} selectedLift={selectedLift} />
              ))}
          </div>
        </>
      )}
    </div>
  );
}

type InputFieldProps = { label: string; value: string | number; type?: string; onChange: (value: string) => void; };
function InputField({ label, value, onChange, type = 'text' }: InputFieldProps) {
  return (<label style={{ display: 'grid', gap: 6 }}><span style={{ fontSize: 12, fontWeight: 600, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fff' }}>{label}</span><input type={type} value={value} onChange={(e) => onChange(e.target.value)} style={darkInputStyle} /></label>);
}

interface MetricCardProps { label: string; value: number; max: number; onChange: (value: number) => void; }
function MetricCard({ label, value, max, onChange }: MetricCardProps) {
  return (<div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20 }}><label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 12, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fff' }}>{label}</label><div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><input type="range" min={0} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1, height: 6, borderRadius: 3, outline: 'none', background: 'rgba(255,255,255,0.1)', cursor: 'pointer' }} /><input type="number" min={0} max={max} value={value} onChange={(e) => onChange(clamp(Number(e.target.value), 0, max))} style={{ width: 60, padding: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#fff', fontSize: 16, fontWeight: 700, textAlign: 'center', outline: 'none', boxSizing: 'border-box' as const }} /></div></div>);
}

interface ExerciseCardProps { exercise: Exercise; log?: ExerciseLog; onUpdateLog: (patch: Partial<ExerciseLog>) => void; }
function ExerciseCard({ exercise, log, onUpdateLog }: ExerciseCardProps) {
  const isPrimary = exercise.primary !== 'accessory';
  const isDumbbell = exercise.name.toLowerCase().includes('dumbbell') || 
                     exercise.name.toLowerCase().includes('lateral raise') ||
                     exercise.name.toLowerCase().includes('hammer curl');
  const inputStyle: React.CSSProperties = { width: '100%', padding: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#fff', fontSize: 15, fontWeight: 600, outline: 'none', boxSizing: 'border-box' as const };
  return (
    <div style={{ background: isPrimary ? 'rgba(100,200,255,0.05)' : 'rgba(255,255,255,0.03)', border: isPrimary ? '1px solid rgba(100,200,255,0.15)' : '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20, transition: 'all 0.2s' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ flex: 1 }}><h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: isPrimary ? '#64c8ff' : '#fff' }}>{exercise.name}</h3><p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.6, color: '#fff' }}>{exercise.muscleGroups.join(', ')}</p></div>
        <div style={{ padding: '6px 12px', background: 'rgba(0,0,0,0.2)', borderRadius: 6, fontSize: 13, fontWeight: 600, color: '#fff' }}>{exercise.sets} × {exercise.reps}</div>
      </div>
      {exercise.targetWeightLb !== undefined && (
        <div style={{ padding: '10px 14px', background: 'rgba(0,0,0,0.2)', borderRadius: 8, marginBottom: 16, fontSize: 14, fontWeight: 600, color: '#fff' }}>
          Target: <span style={{ color: '#64c8ff' }}>{exercise.targetWeightLb} lb</span>
          {isDumbbell && <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.6 }}>(per dumbbell)</span>}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <div><label style={{ display: 'block', fontSize: 11, opacity: 0.6, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fff' }}>Weight (lb){isDumbbell && ' each'}</label><input type="number" value={log?.actualWeightLb ?? ''} onChange={(e) => onUpdateLog({ actualWeightLb: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder={exercise.targetWeightLb?.toString() || '—'} style={inputStyle} /></div>
        <div><label style={{ display: 'block', fontSize: 11, opacity: 0.6, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fff' }}>Reps (10,9,8...)</label><input type="text" value={log?.actualReps ?? ''} onChange={(e) => onUpdateLog({ actualReps: e.target.value })} placeholder="10,9,8" style={inputStyle} /></div>
        <div><label style={{ display: 'block', fontSize: 11, opacity: 0.6, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fff' }}>RPE (1-10)</label><input type="number" min={1} max={10} value={log?.rpe ?? ''} onChange={(e) => onUpdateLog({ rpe: e.target.value === '' ? undefined : clamp(Number(e.target.value), 1, 10) })} placeholder="7" style={inputStyle} /></div>
      </div>
    </div>
  );
}

interface HistoryCardProps { session: Session; isRecent: boolean; selectedLift?: LiftKey | 'all'; }
function HistoryCard({ session, isRecent, selectedLift }: HistoryCardProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ background: isRecent ? 'rgba(100,200,255,0.05)' : 'rgba(255,255,255,0.03)', border: isRecent ? '1px solid rgba(100,200,255,0.15)' : '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden' }}>
      <div onClick={() => setExpanded(!expanded)} style={{ padding: 20, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 6 }}><h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#fff' }}>{session.dayType}</h3>{isRecent && <span style={{ padding: '4px 10px', background: 'rgba(100,200,255,0.2)', borderRadius: 6, fontSize: 11, fontWeight: 700, color: '#64c8ff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Latest</span>}</div>
          <div style={{ display: 'flex', gap: 16, fontSize: 13, opacity: 0.6, flexWrap: 'wrap', color: '#fff' }}><span>{formatDate(session.dateISO)}</span><span>•</span><span>Energy: {session.energy}/5</span><span>•</span><span>Difficulty: {session.difficulty}/5</span>{session.sleepHours && (<><span>•</span><span>Sleep: {session.sleepHours}h</span></>)}</div>
        </div>
        <div style={{ fontSize: 20, opacity: 0.5, transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', color: '#fff' }}>▼</div>
      </div>
      {expanded && (
        <div style={{ padding: '0 20px 20px', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: -10, paddingTop: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {session.workout.map(ex => { const isPrimary = ex.primary !== 'accessory'; const isSelected = selectedLift === 'all' || ex.primary === selectedLift; return (<div key={ex.id} style={{ padding: 14, background: isSelected && isPrimary ? 'rgba(100,200,255,0.1)' : 'rgba(0,0,0,0.2)', border: isSelected && isPrimary ? '1px solid rgba(100,200,255,0.3)' : '1px solid transparent', borderRadius: 8, fontSize: 14 }}><div style={{ fontWeight: 600, marginBottom: 4, color: '#fff' }}>{ex.name}</div><div style={{ opacity: 0.6, fontSize: 12, color: '#fff' }}>{ex.sets} × {ex.reps}{ex.targetWeightLb && <span style={{ marginLeft: 8, color: isSelected && isPrimary ? '#64c8ff' : 'inherit', fontWeight: isSelected && isPrimary ? 700 : 400 }}>@ {ex.targetWeightLb} lb</span>}</div></div>); })}
          </div>
        </div>
      )}
    </div>
  );
}
