'use client';

import React, { useEffect, useMemo, useState } from 'react';

type LiftKey = 'bench' | 'squat' | 'deadlift' | 'ohp' | 'row';
type DayType = 'Push' | 'Pull' | 'Legs' | 'Full';

type Setup = {
  name?: string;
  gender: string;
  heightIn: number;
  weightLb: number;
  goal: 'Hypertrophy' | 'Strength' | 'Health';
  fiveRM: Record<LiftKey, number>; // lbs
};

type Exercise = {
  id: string;
  name: string;
  primary: LiftKey | 'accessory';
  muscleGroups: string[];
  sets: number;
  reps: string; // e.g. "8-10"
  targetWeightLb?: number;
  notes?: string;
};

type ExerciseLog = {
  exerciseId: string;
  actualWeightLb?: number;
  actualReps?: string; // e.g. "10,9,8"
  rpe?: number; // 1-10
  notes?: string;
};

type Session = {
  id: string;
  dateISO: string;
  dayType: DayType;
  muscleGroups: string[];
  energy: number; // 1-5
  difficulty: number; // 1-5
  sleepHours?: number;
  workout: Exercise[];
  logs: ExerciseLog[];
};

const LS_KEY = 'workout_mvp_v1';

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

// Estimate 1RM from 5RM (Epley-ish). This is a practical approximation.
function estimate1RMFrom5RM(fiveRM: number) {
  // Epley: 1RM = w * (1 + reps/30) => reps=5 => w*1.1667
  return fiveRM * (1 + 5 / 30);
}

// Training max to keep progression sustainable
function trainingMax(oneRM: number) {
  return oneRM * 0.9;
}

// Round to nearest 2.5 lb (or 5 if you prefer)
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
  const order: DayType[] = ['Push', 'Pull', 'Legs', 'Full'];

  // pick the first day type not seen recently; else rotate by last
  for (const dt of order) {
    if (!recent.includes(dt)) return dt;
  }
  const last = history[0]?.dayType;
  if (!last) return 'Full';
  const idx = order.indexOf(last);
  return order[(idx + 1) % order.length];
}

function baseWorkoutTemplate(dayType: DayType): Exercise[] {
  // ~5 exercises; big lift + secondary + 3 accessories
  if (dayType === 'Push') {
    return [
      { id: uid('ex'), name: 'Barbell Bench Press', primary: 'bench', muscleGroups: ['Chest', 'Triceps', 'Shoulders'], sets: 4, reps: '6-10' },
      { id: uid('ex'), name: 'Overhead Press', primary: 'ohp', muscleGroups: ['Shoulders', 'Triceps'], sets: 3, reps: '6-10' },
      { id: uid('ex'), name: 'Incline Dumbbell Press', primary: 'accessory', muscleGroups: ['Chest'], sets: 3, reps: '8-12' },
      { id: uid('ex'), name: 'Lateral Raises', primary: 'accessory', muscleGroups: ['Shoulders'], sets: 3, reps: '12-15' },
      { id: uid('ex'), name: 'Triceps Rope Pushdown', primary: 'accessory', muscleGroups: ['Triceps'], sets: 3, reps: '10-15' },
    ];
  }
  if (dayType === 'Pull') {
    return [
      { id: uid('ex'), name: 'Barbell Row', primary: 'row', muscleGroups: ['Back', 'Biceps'], sets: 4, reps: '6-10' },
      { id: uid('ex'), name: 'Pull-Ups / Lat Pulldown', primary: 'accessory', muscleGroups: ['Back'], sets: 3, reps: '6-12' },
      { id: uid('ex'), name: 'Seated Cable Row', primary: 'accessory', muscleGroups: ['Back'], sets: 3, reps: '8-12' },
      { id: uid('ex'), name: 'Face Pulls', primary: 'accessory', muscleGroups: ['Rear Delts'], sets: 3, reps: '12-15' },
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
  // Full
  return [
    { id: uid('ex'), name: 'Deadlift (Technique / Moderate)', primary: 'deadlift', muscleGroups: ['Posterior Chain'], sets: 3, reps: '3-5' },
    { id: uid('ex'), name: 'Bench Press (Moderate)', primary: 'bench', muscleGroups: ['Chest', 'Triceps'], sets: 3, reps: '6-10' },
    { id: uid('ex'), name: 'Barbell Row (Moderate)', primary: 'row', muscleGroups: ['Back'], sets: 3, reps: '6-10' },
    { id: uid('ex'), name: 'Goblet Squat / Front Squat', primary: 'accessory', muscleGroups: ['Quads', 'Core'], sets: 3, reps: '8-12' },
    { id: uid('ex'), name: 'Plank / Hanging Knee Raises', primary: 'accessory', muscleGroups: ['Core'], sets: 3, reps: '30-60s' },
  ];
}

function findLastLiftPerformance(history: Session[], lift: LiftKey) {
  for (const s of history) {
    for (const ex of s.workout) {
      if (ex.primary === lift && ex.targetWeightLb) {
        // get associated log if present
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
}) {
  const { setup, history, lift, dayType } = args;

  const oneRM = estimate1RMFrom5RM(setup.fiveRM[lift] || 0);
  const tMax = trainingMax(oneRM);

  // Base intensity by goal/day type
  // Hypertrophy: 65–75% TM; Strength: 75–85% TM; Health: 60–70% TM
  const basePct =
    setup.goal === 'Strength' ? 0.8 :
    setup.goal === 'Health' ? 0.65 :
    0.7;

  // Full day: reduce intensity a bit
  const dayAdjust = dayType === 'Full' ? -0.05 : 0;
  let target = tMax * (basePct + dayAdjust);

  // Progression using last time
  const last = findLastLiftPerformance(history, lift);
  if (last?.exercise?.targetWeightLb) {
    const lastW = last.exercise.targetWeightLb;

    // If last session was easy + good energy => add 2.5–5 lb
    const lastDifficulty = last.session.difficulty;
    const lastEnergy = last.session.energy;

    let bump = 0;
    if (lastDifficulty <= 2 && lastEnergy >= 4) bump = 5;
    else if (lastDifficulty === 3) bump = 2.5;
    else if (lastDifficulty >= 4 || lastEnergy <= 2) bump = -5;

    target = lastW + bump;
  }

  // sane bounds
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

export default function Page() {
  const [{ setup, history }, setStore] = useState<{ setup: Setup | null; history: Session[] }>({ setup: null, history: [] });

  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    const s = loadState();
    setStore(s);
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
    setDemoMode(true);
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
        dayType: 'Push',
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
        dayType: 'Pull',
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
  }

  function generateTodayWorkout() {
    if (!setup) return;

    const dayType = nextDayType;
    const template = baseWorkoutTemplate(dayType);

    const workout = template.map(ex => {
      if (ex.primary === 'bench' || ex.primary === 'squat' || ex.primary === 'deadlift' || ex.primary === 'ohp' || ex.primary === 'row') {
        const targetWeightLb = computeTargetWeightLb({ setup, history, lift: ex.primary, dayType });
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
      energy: 3,
      difficulty: 3,
      workout,
      logs: workout.map(w => ({ exerciseId: w.id })),
    };

    setStore({ setup, history: [session, ...history] });
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
    setDemoMode(false);
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <div style={styles.h1}>Workout MVP</div>
          <div style={styles.sub}>Daily strength program + logging + progressive overload (LocalStorage)</div>
        </div>

        <div style={styles.headerRight}>
          <label style={styles.toggleRow}>
            <input type="checkbox" checked={demoMode} onChange={(e) => setDemoMode(e.target.checked)} />
            <span style={{ marginLeft: 8 }}>Demo Mode</span>
          </label>
          <button style={styles.btn} onClick={applyDemoData}>Load demo data</button>
          <button style={styles.btnSecondary} onClick={resetAll}>Reset</button>
        </div>
      </div>

      {/* SETUP */}
      <section style={styles.card}>
        <div style={styles.cardTitle}>Setup</div>
        <div style={styles.grid}>
          <Field label="Name">
            <input style={styles.input} value={draftSetup.name ?? ''} onChange={(e) => setDraftSetup({ ...draftSetup, name: e.target.value })} />
          </Field>
          <Field label="Gender">
            <input style={styles.input} value={draftSetup.gender} onChange={(e) => setDraftSetup({ ...draftSetup, gender: e.target.value })} />
          </Field>
          <Field label="Height (in)">
            <input style={styles.input} type="number" value={draftSetup.heightIn} onChange={(e) => setDraftSetup({ ...draftSetup, heightIn: Number(e.target.value) })} />
          </Field>
          <Field label="Weight (lb)">
            <input style={styles.input} type="number" value={draftSetup.weightLb} onChange={(e) => setDraftSetup({ ...draftSetup, weightLb: Number(e.target.value) })} />
          </Field>
          <Field label="Goal">
            <select style={styles.input} value={draftSetup.goal} onChange={(e) => setDraftSetup({ ...draftSetup, goal: e.target.value as Setup['goal'] })}>
              <option>Hypertrophy</option>
              <option>Strength</option>
              <option>Health</option>
            </select>
          </Field>
        </div>

        <div style={{ marginTop: 12, fontWeight: 700 }}>5RM inputs (lbs)</div>
        <div style={styles.grid}>
          {(['bench', 'squat', 'deadlift', 'ohp', 'row'] as LiftKey[]).map(k => (
            <Field key={k} label={k.toUpperCase()}>
              <input
                style={styles.input}
                type="number"
                value={draftSetup.fiveRM[k]}
                onChange={(e) => setDraftSetup({ ...draftSetup, fiveRM: { ...draftSetup.fiveRM, [k]: Number(e.target.value) } })}
              />
            </Field>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button
            style={styles.btn}
            onClick={() => setStore({ setup: draftSetup, history })}
          >
            Save setup
          </button>
          <button
            style={styles.btn}
            disabled={!setup}
            onClick={generateTodayWorkout}
            title={!setup ? 'Save setup first' : 'Generate today'}
          >
            Generate today’s workout
          </button>
        </div>

        {!setup && <div style={styles.note}>Save setup first, then generate today’s workout.</div>}
      </section>

      {/* TODAY */}
      <section style={styles.card}>
        <div style={styles.cardTitle}>Today’s Program</div>

        {!today ? (
          <div style={styles.note}>No workout generated for today yet. Click “Generate today’s workout”.</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
              <Pill>Day: {today.dayType}</Pill>
              <Pill>Muscles: {today.muscleGroups.join(', ')}</Pill>
              <Pill>~60 min</Pill>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <FieldInline label="Energy (1-5)">
                <input style={styles.inputSmall} type="number" min={1} max={5} value={today.energy} onChange={(e) => updateToday({ energy: clamp(Number(e.target.value), 1, 5) })} />
              </FieldInline>
              <FieldInline label="Difficulty (1-5)">
                <input style={styles.inputSmall} type="number" min={1} max={5} value={today.difficulty} onChange={(e) => updateToday({ difficulty: clamp(Number(e.target.value), 1, 5) })} />
              </FieldInline>
              <FieldInline label="Sleep (hrs)">
                <input style={styles.inputSmall} type="number" min={0} max={12} value={today.sleepHours ?? ''} onChange={(e) => updateToday({ sleepHours: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </FieldInline>
            </div>

            <div style={styles.table}>
              <div style={styles.tableHead}>
                <div>Exercise</div>
                <div>Sets</div>
                <div>Reps</div>
                <div>Target (lb)</div>
              </div>

              {today.workout.map(ex => (
                <div key={ex.id} style={styles.tableRow}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{ex.name}</div>
                    <div style={styles.muted}>{ex.muscleGroups.join(', ')}</div>
                  </div>
                  <div>{ex.sets}</div>
                  <div>{ex.reps}</div>
                  <div>{ex.targetWeightLb ?? '—'}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* LOGGER */}
      <section style={styles.card}>
        <div style={styles.cardTitle}>Logger</div>
        {!today ? (
          <div style={styles.note}>Generate today’s workout to log it.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {today.workout.map(ex => {
              const log = today.logs.find(l => l.exerciseId === ex.id);
              return (
                <div key={ex.id} style={styles.logRow}>
                  <div style={{ flex: 2 }}>
                    <div style={{ fontWeight: 700 }}>{ex.name}</div>
                    <div style={styles.muted}>
                      {ex.sets} × {ex.reps} {ex.targetWeightLb ? ` @ ${ex.targetWeightLb} lb target` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, flex: 3, flexWrap: 'wrap' }}>
                    <FieldInline label="Actual lb">
                      <input
                        style={styles.inputSmall}
                        type="number"
                        value={log?.actualWeightLb ?? ''}
                        onChange={(e) => updateExerciseLog(ex.id, { actualWeightLb: e.target.value === '' ? undefined : Number(e.target.value) })}
                      />
                    </FieldInline>
                    <FieldInline label="Reps (e.g. 10,9,8)">
                      <input
                        style={styles.inputSmallWide}
                        value={log?.actualReps ?? ''}
                        onChange={(e) => updateExerciseLog(ex.id, { actualReps: e.target.value })}
                      />
                    </FieldInline>
                    <FieldInline label="RPE (1-10)">
                      <input
                        style={styles.inputSmall}
                        type="number"
                        min={1}
                        max={10}
                        value={log?.rpe ?? ''}
                        onChange={(e) => updateExerciseLog(ex.id, { rpe: e.target.value === '' ? undefined : clamp(Number(e.target.value), 1, 10) })}
                      />
                    </FieldInline>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* HISTORY */}
      <section style={styles.card}>
        <div style={styles.cardTitle}>Recent History</div>
        {history.length === 0 ? (
          <div style={styles.note}>No history yet. Load demo data or generate today’s workout.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {history.slice(0, 10).map(s => (
              <div key={s.id} style={styles.historyRow}>
                <div style={{ fontWeight: 700 }}>{formatDate(s.dateISO)} — {s.dayType}</div>
                <div style={styles.muted}>Energy {s.energy}/5 · Difficulty {s.difficulty}/5 · {s.muscleGroups.join(', ')}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer style={styles.footer}>
        Tip: This demo persists in your browser. Deploy to Vercel for a shareable link.
      </footer>
    </div>
  );
}

function isSameDay(aISO: string, bISO: string) {
  const a = new Date(aISO);
  const b = new Date(bISO);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, opacity: 0.8 }}>{label}</div>
      {children}
    </div>
  );
}

function FieldInline({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ fontSize: 12, opacity: 0.8 }}>{label}</div>
      {children}
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <div style={styles.pill}>{children}</div>;
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 980,
    margin: '0 auto',
    padding: 20,
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
  },
  header: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 16 },
  headerRight: { display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' },
  h1: { fontSize: 28, fontWeight: 800 },
  sub: { opacity: 0.75, marginTop: 4 },
  card: {
    border: '1px solid rgba(0,0,0,0.12)',
    borderRadius: 16,
    padding: 16,
    marginTop: 14,
    boxShadow: '0 6px 20px rgba(0,0,0,0.06)',
  },
  cardTitle: { fontWeight: 800, marginBottom: 10, fontSize: 16 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 10 },
  input: { padding: 10, borderRadius: 10, border: '1px solid rgba(0,0,0,0.2)', width: '100%' },
  inputSmall: { padding: 8, borderRadius: 10, border: '1px solid rgba(0,0,0,0.2)', width: 80 },
  inputSmallWide: { padding: 8, borderRadius: 10, border: '1px solid rgba(0,0,0,0.2)', width: 160 },
  btn: { padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(0,0,0,0.2)', fontWeight: 700, cursor: 'pointer' },
  btnSecondary: { padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(0,0,0,0.2)', opacity: 0.8, cursor: 'pointer', background: 'transparent' },
  note: { marginTop: 10, opacity: 0.75 },
  muted: { fontSize: 12, opacity: 0.7, marginTop: 2 },
  pill: { border: '1px solid rgba(0,0,0,0.18)', padding: '6px 10px', borderRadius: 999, fontSize: 12, opacity: 0.9 },
  table: { border: '1px solid rgba(0,0,0,0.12)', borderRadius: 12, overflow: 'hidden' },
  tableHead: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: 10, fontWeight: 800, background: 'rgba(0,0,0,0.04)' },
  tableRow: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: 10, borderTop: '1px solid rgba(0,0,0,0.08)', alignItems: 'center' },
  logRow: { display: 'flex', gap: 12, padding: 12, border: '1px solid rgba(0,0,0,0.10)', borderRadius: 12 },
  historyRow: { padding: 12, border: '1px solid rgba(0,0,0,0.10)', borderRadius: 12 },
  toggleRow: { display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none' },
  footer: { marginTop: 18, opacity: 0.6, fontSize: 12 },
};
