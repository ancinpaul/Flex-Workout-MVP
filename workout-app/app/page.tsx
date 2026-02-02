'use client';

import React, { useEffect, useMemo, useState } from 'react';

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
};

const LS_KEY = 'workout_mvp_v1';

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

function computeTargetWeightLb(args: {
  setup: Setup;
  history: Session[];
  lift: LiftKey;
  dayType: DayType;
  currentEnergy?: number;
  currentSleep?: number;
}) {
  const { setup, history, lift, currentEnergy = 3, currentSleep } = args;

  const oneRM = estimate1RMFrom5RM(setup.fiveRM[lift] || 0);
  const tMax = trainingMax(oneRM);

  const basePct =
    setup.goal === 'Strength' ? 0.8 :
    setup.goal === 'Health' ? 0.65 :
    0.7;

  let target = tMax * basePct;

  // Apply current session modifiers FIRST (before historical progression)
  let sessionModifier = 0;
  
  // Energy-based adjustment (-5 to +5 lb)
  if (currentEnergy <= 2) sessionModifier -= 5; // Low energy: reduce weight
  else if (currentEnergy >= 4) sessionModifier += 5; // High energy: increase weight
  
  // Sleep-based adjustment (-2.5 to +2.5 lb)
  if (currentSleep !== undefined) {
    if (currentSleep < 6) sessionModifier -= 2.5; // Poor sleep: reduce weight
    else if (currentSleep >= 8) sessionModifier += 2.5; // Good sleep: increase weight
  }

  const last = findLastLiftPerformance(history, lift);
  if (last?.exercise?.targetWeightLb) {
    const lastW = last.exercise.targetWeightLb;
    const lastDifficulty = last.session.difficulty;
    const lastEnergy = last.session.energy;

    // Historical progression bump
    let bump = 0;
    if (lastDifficulty <= 2 && lastEnergy >= 4) bump = 5;
    else if (lastDifficulty === 3) bump = 2.5;
    else if (lastDifficulty >= 4 || lastEnergy <= 2) bump = -5;

    target = lastW + bump;
  }

  // Apply session modifiers on top of progression
  target += sessionModifier;

  target = clamp(target, tMax * 0.55, tMax * 0.9);

  return roundTo2_5(target);
}

function loadState(): { setup: Setup | null; history: Session[] } {
  if (typeof window === 'undefined') return { setup: null, history: [] };
  const raw = window.localStorage.getItem(LS_KEY);
  if (!raw) return { setup: null, history: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      setup: parsed.setup ?? null,
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return { setup: null, history: [] };
  }
}

function saveState(setup: Setup | null, history: Session[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LS_KEY, JSON.stringify({ setup, history }));
}

function isSameDay(aISO: string, bISO: string) {
  const a = new Date(aISO);
  const b = new Date(bISO);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function Page() {
  const [{ setup, history }, setStore] = useState<{ setup: Setup | null; history: Session[] }>({ setup: null, history: [] });
  const [activeTab, setActiveTab] = useState<'today' | 'history' | 'setup'>('today');

  useEffect(() => {
    const s = loadState();
    setStore(s);
    if (!s.setup) setActiveTab('setup');
  }, []);

  useEffect(() => {
    saveState(setup, history);
  }, [setup, history]);

  const nextDayType = useMemo(() => pickNextDayType(history), [history]);

  const [draftSetup, setDraftSetup] = useState<Setup>({
    name: 'Paul',
    gender: 'Male',
    heightIn: 70,
    weightLb: 180,
    goal: 'Hypertrophy',
    fiveRM: { bench: 225, squat: 275, deadlift: 315, ohp: 135, row: 185 },
  });

  useEffect(() => {
    if (setup) setDraftSetup(setup);
  }, [setup]);

  function applyDemoData() {
    const demoSetup: Setup = {
      name: 'Demo Athlete',
      gender: 'Male',
      heightIn: 70,
      weightLb: 180,
      goal: 'Hypertrophy',
      fiveRM: { bench: 225, squat: 275, deadlift: 315, ohp: 135, row: 185 },
    };

    const demoHistory: Session[] = [
      {
        id: uid('sess'),
        dateISO: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
        dayType: 'Chest & Triceps',
        muscleGroups: ['Chest', 'Shoulders', 'Triceps'],
        energy: 4,
        difficulty: 3,
        sleepHours: 7,
        workout: [
          { id: uid('ex'), name: 'Barbell Bench Press', primary: 'bench', muscleGroups: ['Chest', 'Triceps'], sets: 4, reps: '6-10', targetWeightLb: 175 },
          { id: uid('ex'), name: 'Overhead Press', primary: 'ohp', muscleGroups: ['Shoulders'], sets: 3, reps: '6-10', targetWeightLb: 105 },
          { id: uid('ex'), name: 'Incline Dumbbell Press', primary: 'accessory', muscleGroups: ['Chest'], sets: 3, reps: '8-12' },
          { id: uid('ex'), name: 'Lateral Raises', primary: 'accessory', muscleGroups: ['Shoulders'], sets: 3, reps: '12-15' },
          { id: uid('ex'), name: 'Triceps Rope Pushdown', primary: 'accessory', muscleGroups: ['Triceps'], sets: 3, reps: '10-15' },
        ],
        logs: [],
      },
      {
        id: uid('sess'),
        dateISO: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
        dayType: 'Back & Biceps',
        muscleGroups: ['Back', 'Biceps'],
        energy: 3,
        difficulty: 4,
        sleepHours: 6,
        workout: [
          { id: uid('ex'), name: 'Barbell Row', primary: 'row', muscleGroups: ['Back'], sets: 4, reps: '6-10', targetWeightLb: 145 },
          { id: uid('ex'), name: 'Pull-Ups / Lat Pulldown', primary: 'accessory', muscleGroups: ['Back'], sets: 3, reps: '6-12' },
          { id: uid('ex'), name: 'Seated Cable Row', primary: 'accessory', muscleGroups: ['Back'], sets: 3, reps: '8-12' },
          { id: uid('ex'), name: 'Face Pulls', primary: 'accessory', muscleGroups: ['Rear Delts'], sets: 3, reps: '12-15' },
          { id: uid('ex'), name: 'Dumbbell Curls', primary: 'accessory', muscleGroups: ['Biceps'], sets: 3, reps: '10-15' },
        ],
        logs: [],
      },
    ];

    setStore({ setup: demoSetup, history: demoHistory });
    setActiveTab('today');
  }

  function generateTodayWorkout(energy = 3, sleepHours?: number) {
    if (!setup) return;

    const dayType = nextDayType;
    const template = baseWorkoutTemplate(dayType);

    const workout = template.map(ex => {
      if (ex.primary === 'bench' || ex.primary === 'squat' || ex.primary === 'deadlift' || ex.primary === 'ohp' || ex.primary === 'row') {
        const targetWeightLb = computeTargetWeightLb({ 
          setup, 
          history, 
          lift: ex.primary, 
          dayType,
          currentEnergy: energy,
          currentSleep: sleepHours,
        });
        return { ...ex, targetWeightLb };
      }
      return ex;
    });

    const muscleGroups = Array.from(new Set(workout.flatMap(w => w.muscleGroups)));

    const session: Session = {
      id: uid('sess'),
      dateISO: new Date().toISOString(),
      dayType,
      muscleGroups,
      energy,
      difficulty: 3,
      sleepHours,
      workout,
      logs: workout.map(w => ({ exerciseId: w.id })),
    };

    setStore({ setup, history: [session, ...history] });
    setActiveTab('today');
  }

  function regenerateWorkoutWeights(energy: number, difficulty: number, sleepHours?: number) {
    if (!today || !setup) return;

    // Recalculate weights for all primary lifts
    const updatedWorkout = today.workout.map(ex => {
      if (ex.primary === 'bench' || ex.primary === 'squat' || ex.primary === 'deadlift' || ex.primary === 'ohp' || ex.primary === 'row') {
        const targetWeightLb = computeTargetWeightLb({ 
          setup, 
          history: history.slice(1), // Exclude current session from history
          lift: ex.primary, 
          dayType: today.dayType,
          currentEnergy: energy,
          currentSleep: sleepHours,
        });
        return { ...ex, targetWeightLb };
      }
      return ex;
    });

    updateToday({ workout: updatedWorkout, energy, difficulty, sleepHours });
  }

  const today = history[0] && isSameDay(history[0].dateISO, new Date().toISOString()) ? history[0] : null;

  function updateToday(patch: Partial<Session>) {
    if (!today) return;
    const updated = { ...today, ...patch };
    setStore({ setup, history: [updated, ...history.slice(1)] });
  }

  function updateExerciseLog(exId: string, patch: Partial<ExerciseLog>) {
    if (!today) return;
    const logs = today.logs.map(l => (l.exerciseId === exId ? { ...l, ...patch } : l));
    updateToday({ logs });
  }

  function resetAll() {
    window.localStorage.removeItem(LS_KEY);
    setStore({ setup: null, history: [] });
    setActiveTab('setup');
  }

  return (
    <div style={{ 
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%)',
      color: '#f5f5f5',
      fontFamily: '"Outfit", "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
    }}>
      {/* Header */}
      <header style={{
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(0,0,0,0.3)',
        backdropFilter: 'blur(20px)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ 
          maxWidth: 1200, 
          margin: '0 auto', 
          padding: '20px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <h1 style={{ 
              margin: 0, 
              fontSize: 32, 
              fontWeight: 800,
              background: 'linear-gradient(135deg, #fff 0%, #a0a0a0 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: '-0.02em',
            }}>
              FLEX
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.6, fontWeight: 400 }}>
              Adaptive strength training
            </p>
          </div>
          
          <div style={{ display: 'flex', gap: 12 }}>
            <button 
              onClick={applyDemoData}
              style={{
                padding: '10px 20px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
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
              Load Demo
            </button>
            <button 
              onClick={resetAll}
              style={{
                padding: '10px 20px',
                background: 'rgba(255,50,50,0.1)',
                border: '1px solid rgba(255,50,50,0.2)',
                borderRadius: 8,
                color: '#ff6b6b',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255,50,50,0.2)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255,50,50,0.1)';
              }}
            >
              Reset All
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '0 24px',
          display: 'flex',
          gap: 4,
        }}>
          {(['today', 'history', 'setup'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '12px 24px',
                background: activeTab === tab ? 'rgba(255,255,255,0.08)' : 'transparent',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid #fff' : '2px solid transparent',
                color: activeTab === tab ? '#fff' : 'rgba(255,255,255,0.5)',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </header>

      {/* Main Content */}
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        {activeTab === 'setup' && (
          <SetupView 
            draftSetup={draftSetup}
            setDraftSetup={setDraftSetup}
            onSave={() => setStore({ setup: draftSetup, history })}
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
            onUpdateToday={updateToday}
            onUpdateLog={updateExerciseLog}
            onRegenerateWeights={regenerateWorkoutWeights}
            hasSetup={!!setup}
          />
        )}

        {activeTab === 'history' && (
          <HistoryView history={history} />
        )}
      </main>
    </div>
  );
}

function SetupView({ draftSetup, setDraftSetup, onSave, onGenerate, hasSetup }: any) {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        padding: 32,
      }}>
        <h2 style={{ margin: '0 0 24px', fontSize: 24, fontWeight: 700 }}>Profile Setup</h2>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 32 }}>
          <InputField label="Name" value={draftSetup.name ?? ''} onChange={(v) => setDraftSetup({ ...draftSetup, name: v })} />
          <InputField label="Gender" value={draftSetup.gender} onChange={(v) => setDraftSetup({ ...draftSetup, gender: v })} />
          <InputField label="Height (in)" type="number" value={draftSetup.heightIn} onChange={(v) => setDraftSetup({ ...draftSetup, heightIn: Number(v) })} />
          <InputField label="Weight (lb)" type="number" value={draftSetup.weightLb} onChange={(v) => setDraftSetup({ ...draftSetup, weightLb: Number(v) })} />
          
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Goal
            </label>
            <select 
              value={draftSetup.goal} 
              onChange={(e) => setDraftSetup({ ...draftSetup, goal: e.target.value as Setup['goal'] })}
              style={{
                width: '100%',
                padding: 12,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                color: '#fff',
                fontSize: 14,
                outline: 'none',
              }}
            >
              <option>Hypertrophy</option>
              <option>Strength</option>
              <option>Health</option>
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, opacity: 0.9 }}>5-Rep Max (lbs)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16 }}>
            {(['bench', 'squat', 'deadlift', 'ohp', 'row'] as LiftKey[]).map(k => (
              <InputField 
                key={k}
                label={k.toUpperCase()} 
                type="number"
                value={draftSetup.fiveRM[k]} 
                onChange={(v) => setDraftSetup({ ...draftSetup, fiveRM: { ...draftSetup.fiveRM, [k]: Number(v) } })} 
              />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
          <button
            onClick={onSave}
            style={{
              flex: 1,
              padding: '14px 24px',
              background: 'linear-gradient(135deg, #fff 0%, #d0d0d0 100%)',
              border: 'none',
              borderRadius: 10,
              color: '#000',
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'transform 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            Save Profile
          </button>
          
          <button
            onClick={onGenerate}
            disabled={!hasSetup}
            style={{
              flex: 1,
              padding: '14px 24px',
              background: hasSetup ? 'rgba(100,200,255,0.2)' : 'rgba(255,255,255,0.05)',
              border: hasSetup ? '1px solid rgba(100,200,255,0.4)' : '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10,
              color: hasSetup ? '#64c8ff' : 'rgba(255,255,255,0.3)',
              fontSize: 15,
              fontWeight: 700,
              cursor: hasSetup ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
            }}
          >
            Generate Today's Workout
          </button>
        </div>
      </div>
    </div>
  );
}

function TodayView({ today, nextDayType, history, onGenerate, onUpdateToday, onUpdateLog, onRegenerateWeights, hasSetup }: any) {
  if (!today) {
    return (
      <div style={{ 
        maxWidth: 600, 
        margin: '120px auto',
        textAlign: 'center',
      }}>
        <div style={{
          width: 80,
          height: 80,
          margin: '0 auto 24px',
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.05)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 40,
        }}>
          💪
        </div>
        <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>No Workout Yet</h2>
        <p style={{ opacity: 0.6, marginBottom: 32, fontSize: 15 }}>
          {hasSetup 
            ? `Ready to start a ${nextDayType} workout?` 
            : 'Complete your profile setup first, then generate your workout.'}
        </p>
        <button
          onClick={() => onGenerate()}
          disabled={!hasSetup}
          style={{
            padding: '16px 40px',
            background: hasSetup ? 'linear-gradient(135deg, #fff 0%, #d0d0d0 100%)' : 'rgba(255,255,255,0.1)',
            border: 'none',
            borderRadius: 12,
            color: hasSetup ? '#000' : 'rgba(255,255,255,0.3)',
            fontSize: 16,
            fontWeight: 700,
            cursor: hasSetup ? 'pointer' : 'not-allowed',
            transition: 'transform 0.2s',
          }}
          onMouseEnter={e => hasSetup && (e.currentTarget.style.transform = 'scale(1.05)')}
          onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
        >
          Generate Workout
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Workout Header */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(100,200,255,0.1) 0%, rgba(150,100,255,0.1) 100%)',
        border: '1px solid rgba(100,200,255,0.2)',
        borderRadius: 16,
        padding: 24,
        marginBottom: 24,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>{today.dayType}</h2>
            <p style={{ margin: '6px 0 0', opacity: 0.7, fontSize: 14 }}>
              {today.muscleGroups.join(' • ')}
            </p>
          </div>
          <div style={{
            padding: '8px 16px',
            background: 'rgba(255,255,255,0.1)',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
          }}>
            ~60 min
          </div>
        </div>

        {history.length > 1 && (
          <div style={{
            padding: 16,
            background: 'rgba(0,0,0,0.2)',
            borderRadius: 10,
            fontSize: 13,
            lineHeight: 1.6,
            opacity: 0.9,
          }}>
            Last workout: <strong>{history[1].dayType}</strong> ({Math.max(1, Math.round((Date.now() - new Date(history[1].dateISO).getTime()) / (1000 * 60 * 60 * 24)))} days ago)
            — Difficulty {history[1].difficulty}/5, Energy {history[1].energy}/5
          </div>
        )}
      </div>

      {/* Session Metrics */}
      <div style={{ 
        background: 'rgba(255,200,100,0.05)',
        border: '1px solid rgba(255,200,100,0.15)',
        borderRadius: 12,
        padding: 20,
        marginBottom: 24,
      }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 8, 
          marginBottom: 16,
          fontSize: 13,
          fontWeight: 600,
          color: '#ffcc66',
        }}>
          <span>⚡</span>
          <span>Adjust these to automatically update your workout weights</span>
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <MetricCard 
            label="Energy Level"
            value={today.energy}
            max={5}
           onChange={(v: number) => onRegenerateWeights(v, today.difficulty, today.sleepHours)}
          />
          <MetricCard 
            label="Difficulty"
            value={today.difficulty}
            max={5}
            onChange={(v: number) => onRegenerateWeights(today.energy, v, today.sleepHours)}
          />
          <MetricCard 
            label="Sleep (hours)"
            value={today.sleepHours ?? 0}
            max={12}
            onChange={(v: number) => onRegenerateWeights(today.energy, today.difficulty, v || undefined)}
          />
        </div>
      </div>

      {/* Exercises */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {today.workout.map((ex: Exercise) => {
          const log = today.logs.find((l: ExerciseLog) => l.exerciseId === ex.id);
          return (
            <ExerciseCard 
              key={ex.id}
              exercise={ex}
              log={log}
              onUpdateLog={(patch: Partial<ExerciseLog>) => onUpdateLog(ex.id, patch)}
            />
          );
        })}
      </div>
    </div>
  );
}

function extractProgressData(
  history: Session[], 
  selectedDayType: DayType | 'all',
  selectedLift: LiftKey | 'all'
) {
  const data: Array<{
    date: string;
    dateISO: string;
    dayType: DayType;
    lift: LiftKey;
    liftName: string;
    weight: number;
    energy: number;
    difficulty: number;
  }> = [];

  // Filter by day type first
  const filteredHistory = selectedDayType === 'all' 
    ? history 
    : history.filter(s => s.dayType === selectedDayType);

  filteredHistory.forEach(session => {
    session.workout.forEach(exercise => {
      if (exercise.primary !== 'accessory' && exercise.targetWeightLb) {
        const lift = exercise.primary as LiftKey;
        
        // Filter by lift if specified
        if (selectedLift === 'all' || lift === selectedLift) {
          data.push({
            date: formatDate(session.dateISO),
            dateISO: session.dateISO,
            dayType: session.dayType,
            lift,
            liftName: exercise.name,
            weight: exercise.targetWeightLb,
            energy: session.energy,
            difficulty: session.difficulty,
          });
        }
      }
    });
  });

  // Sort by date (oldest first for chart)
  return data.sort((a, b) => new Date(a.dateISO).getTime() - new Date(b.dateISO).getTime());
}

function ProgressChart({ data, selectedLift }: { 
  data: ReturnType<typeof extractProgressData>,
  selectedLift: LiftKey | 'all'
}) {
  if (data.length === 0) {
    return (
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        padding: 40,
        textAlign: 'center',
      }}>
        <p style={{ opacity: 0.6 }}>No data available for selected filters</p>
      </div>
    );
  }

  // Group by lift type
  const liftGroups: Record<LiftKey, typeof data> = {
    bench: [],
    squat: [],
    deadlift: [],
    ohp: [],
    row: [],
  };

  data.forEach(point => {
    liftGroups[point.lift].push(point);
  });

  // Calculate chart dimensions and scales
  const chartWidth = 800;
  const chartHeight = 400;
  const padding = { top: 40, right: 60, bottom: 60, left: 60 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  // Find min/max weights across all data
  const allWeights = data.map(d => d.weight);
  const minWeight = Math.floor(Math.min(...allWeights) / 10) * 10 - 10;
  const maxWeight = Math.ceil(Math.max(...allWeights) / 10) * 10 + 10;

  // Colors for each lift
  const liftColors: Record<LiftKey, string> = {
    bench: '#64c8ff',
    squat: '#ff6b9d',
    deadlift: '#ffd93d',
    ohp: '#95e1d3',
    row: '#c77dff',
  };

  const liftNames: Record<LiftKey, string> = {
    bench: 'Bench Press',
    squat: 'Squat',
    deadlift: 'Deadlift',
    ohp: 'Overhead Press',
    row: 'Barbell Row',
  };

  // Create scales
  const xScale = (index: number, total: number) => {
    return padding.left + (index / Math.max(1, total - 1)) * innerWidth;
  };

  const yScale = (weight: number) => {
    return chartHeight - padding.bottom - ((weight - minWeight) / (maxWeight - minWeight)) * innerHeight;
  };

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 16,
      padding: 24,
      overflow: 'hidden',
    }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>
        Weight Progress Over Time
      </h3>

      <div style={{ overflowX: 'auto' }}>
        <svg width={chartWidth} height={chartHeight} style={{ display: 'block' }}>
          {/* Grid lines */}
          {[0, 1, 2, 3, 4].map(i => {
            const weight = minWeight + (i / 4) * (maxWeight - minWeight);
            const y = yScale(weight);
            return (
              <g key={i}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={chartWidth - padding.right}
                  y2={y}
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth={1}
                />
                <text
                  x={padding.left - 10}
                  y={y + 4}
                  fill="rgba(255,255,255,0.5)"
                  fontSize={12}
                  textAnchor="end"
                >
                  {Math.round(weight)}
                </text>
              </g>
            );
          })}

          {/* X-axis */}
          <line
            x1={padding.left}
            y1={chartHeight - padding.bottom}
            x2={chartWidth - padding.right}
            y2={chartHeight - padding.bottom}
            stroke="rgba(255,255,255,0.2)"
            strokeWidth={2}
          />

          {/* Y-axis */}
          <line
            x1={padding.left}
            y1={padding.top}
            x2={padding.left}
            y2={chartHeight - padding.bottom}
            stroke="rgba(255,255,255,0.2)"
            strokeWidth={2}
          />

          {/* Y-axis label */}
          <text
            x={20}
            y={padding.top + innerHeight / 2}
            fill="rgba(255,255,255,0.6)"
            fontSize={14}
            fontWeight={600}
            textAnchor="middle"
            transform={`rotate(-90, 20, ${padding.top + innerHeight / 2})`}
          >
            Weight (lbs)
          </text>

          {/* Plot lines for each lift */}
          {Object.entries(liftGroups).map(([lift, points]) => {
            if (points.length === 0) return null;

            const pathData = points.map((point, i) => {
              const x = xScale(data.indexOf(point), data.length);
              const y = yScale(point.weight);
              return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
            }).join(' ');

            return (
              <g key={lift}>
                {/* Line */}
                <path
                  d={pathData}
                  fill="none"
                  stroke={liftColors[lift as LiftKey]}
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                
                {/* Points */}
                {points.map((point, i) => {
                  const x = xScale(data.indexOf(point), data.length);
                  const y = yScale(point.weight);
                  
                  return (
                    <g key={i}>
                      <circle
                        cx={x}
                        cy={y}
                        r={5}
                        fill={liftColors[lift as LiftKey]}
                        stroke="rgba(0,0,0,0.5)"
                        strokeWidth={2}
                      />
                      {/* Tooltip on hover */}
                      <title>{`${point.liftName}: ${point.weight} lbs\n${point.date}\nEnergy: ${point.energy}/5`}</title>
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* Date labels */}
          {data.map((point, i) => {
            if (i % Math.max(1, Math.floor(data.length / 6)) === 0 || i === data.length - 1) {
              const x = xScale(i, data.length);
              return (
                <text
                  key={i}
                  x={x}
                  y={chartHeight - padding.bottom + 20}
                  fill="rgba(255,255,255,0.5)"
                  fontSize={11}
                  textAnchor="middle"
                  transform={`rotate(-45, ${x}, ${chartHeight - padding.bottom + 20})`}
                >
                  {point.date}
                </text>
              );
            }
            return null;
          })}
        </svg>
      </div>

      {/* Legend */}
      <div style={{ 
        display: 'flex', 
        gap: 20, 
        marginTop: 24, 
        flexWrap: 'wrap',
        justifyContent: 'center',
      }}>
        {Object.entries(liftGroups)
          .filter(([_, points]) => points.length > 0)
          .map(([lift, points]) => (
            <div 
              key={lift}
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 8,
              }}
            >
              <div style={{
                width: 16,
                height: 16,
                borderRadius: '50%',
                background: liftColors[lift as LiftKey],
              }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {liftNames[lift as LiftKey]} ({points.length})
              </span>
            </div>
          ))}
      </div>

      {/* Stats Summary */}
      <div style={{
        marginTop: 24,
        padding: 16,
        background: 'rgba(0,0,0,0.2)',
        borderRadius: 10,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 16,
      }}>
        {Object.entries(liftGroups)
          .filter(([_, points]) => points.length > 0)
          .map(([lift, points]) => {
            const weights = points.map(p => p.weight);
            const firstWeight = weights[0];
            const lastWeight = weights[weights.length - 1];
            const change = lastWeight - firstWeight;
            const percentChange = ((change / firstWeight) * 100).toFixed(1);

            return (
              <div key={lift} style={{ textAlign: 'center' }}>
                <div style={{ 
                  fontSize: 11, 
                  opacity: 0.6, 
                  marginBottom: 4,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}>
                  {liftNames[lift as LiftKey]}
                </div>
                <div style={{ 
                  fontSize: 20, 
                  fontWeight: 700,
                  color: change >= 0 ? '#4ade80' : '#ff6b6b',
                }}>
                  {change >= 0 ? '+' : ''}{change} lbs
                </div>
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                  {change >= 0 ? '+' : ''}{percentChange}% gain
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

function HistoryView({ history }: { history: Session[] }) {
  const [selectedDayType, setSelectedDayType] = useState<DayType | 'all'>('all');
  const [selectedLift, setSelectedLift] = useState<LiftKey | 'all'>('all');

  if (history.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '120px 0' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>No History Yet</h2>
        <p style={{ opacity: 0.6 }}>Your workout history will appear here once you start tracking.</p>
      </div>
    );
  }

  // Get all unique day types from history
  const dayTypes: DayType[] = Array.from(new Set(history.map(s => s.dayType)));
  
  // Extract progress data for charts
  const progressData = extractProgressData(history, selectedDayType, selectedLift);

  return (
    <div>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Workout History & Progress</h2>
      
      {/* Filters */}
      <div style={{ 
        display: 'flex', 
        gap: 12, 
        marginBottom: 32,
        flexWrap: 'wrap',
      }}>
        <div>
          <label style={{ 
            display: 'block', 
            fontSize: 12, 
            fontWeight: 600, 
            marginBottom: 8, 
            opacity: 0.7,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            Workout Type
          </label>
          <select 
            value={selectedDayType} 
            onChange={(e) => setSelectedDayType(e.target.value as DayType | 'all')}
            style={{
              padding: '10px 16px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="all">All Workouts</option>
            {dayTypes.map(dt => (
              <option key={dt} value={dt}>{dt}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ 
            display: 'block', 
            fontSize: 12, 
            fontWeight: 600, 
            marginBottom: 8, 
            opacity: 0.7,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            Primary Lift
          </label>
          <select 
            value={selectedLift} 
            onChange={(e) => setSelectedLift(e.target.value as LiftKey | 'all')}
            style={{
              padding: '10px 16px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="all">All Lifts</option>
            <option value="bench">Bench Press</option>
            <option value="squat">Squat</option>
            <option value="deadlift">Deadlift</option>
            <option value="ohp">Overhead Press</option>
            <option value="row">Barbell Row</option>
          </select>
        </div>
      </div>

      {/* Progress Charts */}
      {progressData.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <ProgressChart data={progressData} selectedLift={selectedLift} />
        </div>
      )}

      {/* Session List */}
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, marginTop: 40 }}>
        Session Log
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {history
          .filter(s => selectedDayType === 'all' || s.dayType === selectedDayType)
          .map((session, idx) => (
            <HistoryCard 
              key={session.id} 
              session={session} 
              isRecent={idx === 0}
              selectedLift={selectedLift}
            />
          ))}
      </div>
    </div>
  );
}

type InputFieldProps = {
  label: string;
  value: string | number;
  type?: string;
  onChange: (value: string) => void;
};

function InputField({ label, value, onChange, type = 'text' }: InputFieldProps) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontSize: 12, opacity: 0.75 }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: 12,
          borderRadius: 12,
          border: '1px solid rgba(0,0,0,0.15)',
          outline: 'none',
        }}
      />
    </label>
  );
}


function MetricCard({ label, value, max, onChange }: any) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 12,
      padding: 20,
    }}>
      <label style={{ 
        display: 'block', 
        fontSize: 12, 
        fontWeight: 600, 
        marginBottom: 12, 
        opacity: 0.7,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>
        {label}
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <input
          type="range"
          min={0}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            flex: 1,
            height: 6,
            borderRadius: 3,
            outline: 'none',
            background: 'rgba(255,255,255,0.1)',
          }}
        />
        <input
          type="number"
          min={0}
          max={max}
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value), 0, max))}
          style={{
            width: 60,
            padding: 8,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6,
            color: '#fff',
            fontSize: 16,
            fontWeight: 700,
            textAlign: 'center',
            outline: 'none',
          }}
        />
      </div>
    </div>
  );
}

function ExerciseCard({ exercise, log, onUpdateLog }: any) {
  const isPrimary = exercise.primary !== 'accessory';
  
  return (
    <div style={{
      background: isPrimary ? 'rgba(100,200,255,0.05)' : 'rgba(255,255,255,0.03)',
      border: isPrimary ? '1px solid rgba(100,200,255,0.15)' : '1px solid rgba(255,255,255,0.08)',
      borderRadius: 12,
      padding: 20,
      transition: 'all 0.2s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ 
            margin: 0, 
            fontSize: 18, 
            fontWeight: 700,
            color: isPrimary ? '#64c8ff' : '#fff',
          }}>
            {exercise.name}
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.6 }}>
            {exercise.muscleGroups.join(', ')}
          </p>
        </div>
        <div style={{
          padding: '6px 12px',
          background: 'rgba(0,0,0,0.2)',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 600,
        }}>
          {exercise.sets} × {exercise.reps}
        </div>
      </div>

      {exercise.targetWeightLb && (
        <div style={{
          padding: '10px 14px',
          background: 'rgba(0,0,0,0.2)',
          borderRadius: 8,
          marginBottom: 16,
          fontSize: 14,
          fontWeight: 600,
        }}>
          Target: <span style={{ color: '#64c8ff' }}>{exercise.targetWeightLb} lb</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 11, opacity: 0.6, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Weight (lb)
          </label>
          <input
            type="number"
            value={log?.actualWeightLb ?? ''}
            onChange={(e) => onUpdateLog({ actualWeightLb: e.target.value === '' ? undefined : Number(e.target.value) })}
            placeholder={exercise.targetWeightLb || '—'}
            style={{
              width: '100%',
              padding: 10,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              outline: 'none',
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 11, opacity: 0.6, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Reps (10,9,8...)
          </label>
          <input
            type="text"
            value={log?.actualReps ?? ''}
            onChange={(e) => onUpdateLog({ actualReps: e.target.value })}
            placeholder="10,9,8"
            style={{
              width: '100%',
              padding: 10,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              outline: 'none',
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 11, opacity: 0.6, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            RPE (1-10)
          </label>
          <input
            type="number"
            min={1}
            max={10}
            value={log?.rpe ?? ''}
            onChange={(e) => onUpdateLog({ rpe: e.target.value === '' ? undefined : clamp(Number(e.target.value), 1, 10) })}
            placeholder="7"
            style={{
              width: '100%',
              padding: 10,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              outline: 'none',
            }}
          />
        </div>
      </div>
    </div>
  );
}

function HistoryCard({ session, isRecent, selectedLift }: { 
  session: Session; 
  isRecent: boolean;
  selectedLift?: LiftKey | 'all';
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      background: isRecent ? 'rgba(100,200,255,0.05)' : 'rgba(255,255,255,0.03)',
      border: isRecent ? '1px solid rgba(100,200,255,0.15)' : '1px solid rgba(255,255,255,0.08)',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      <div 
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: 20,
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 6 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              {session.dayType}
            </h3>
            {isRecent && (
              <span style={{
                padding: '4px 10px',
                background: 'rgba(100,200,255,0.2)',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 700,
                color: '#64c8ff',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>
                Latest
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 13, opacity: 0.6, flexWrap: 'wrap' }}>
            <span>{formatDate(session.dateISO)}</span>
            <span>•</span>
            <span>Energy: {session.energy}/5</span>
            <span>•</span>
            <span>Difficulty: {session.difficulty}/5</span>
            {session.sleepHours && (
              <>
                <span>•</span>
                <span>Sleep: {session.sleepHours}h</span>
              </>
            )}
          </div>
        </div>
        <div style={{ 
          fontSize: 20, 
          opacity: 0.5,
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s',
        }}>
          ▼
        </div>
      </div>

      {expanded && (
        <div style={{
          padding: '0 20px 20px',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          marginTop: -10,
          paddingTop: 20,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {session.workout.map(ex => {
              const isPrimary = ex.primary !== 'accessory';
              const isSelected = selectedLift === 'all' || ex.primary === selectedLift;
              
              return (
                <div 
                  key={ex.id}
                  style={{
                    padding: 14,
                    background: isSelected && isPrimary ? 'rgba(100,200,255,0.1)' : 'rgba(0,0,0,0.2)',
                    border: isSelected && isPrimary ? '1px solid rgba(100,200,255,0.3)' : '1px solid transparent',
                    borderRadius: 8,
                    fontSize: 14,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{ex.name}</div>
                  <div style={{ opacity: 0.6, fontSize: 12 }}>
                    {ex.sets} × {ex.reps}
                    {ex.targetWeightLb && (
                      <span style={{ 
                        marginLeft: 8,
                        color: isSelected && isPrimary ? '#64c8ff' : 'inherit',
                        fontWeight: isSelected && isPrimary ? 700 : 400,
                      }}>
                        @ {ex.targetWeightLb} lb
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
