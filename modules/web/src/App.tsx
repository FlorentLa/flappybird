import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppConfig } from './config';
import { signIn, signOut, currentEmail } from './auth';
import { getTopScores, submitScore, type ScoreEntry } from './api';

// ============================================================
// Game constants
// ============================================================
const W = 480;
const H = 640;
const GRAVITY = 0.45;
const JUMP_FORCE = -8.5;
const PIPE_WIDTH = 60;
const PIPE_GAP = 160;
const PIPE_SPEED = 3;
const PIPE_INTERVAL = 1500; // ms

interface Pipe {
  x: number;
  topH: number;
  passed: boolean;
}

interface GameState {
  birdY: number;
  birdVy: number;
  pipes: Pipe[];
  score: number;
  phase: 'idle' | 'playing' | 'dead';
  lastPipe: number;
  frame: number;
}

function makeInitialState(): GameState {
  return {
    birdY: H / 2,
    birdVy: 0,
    pipes: [],
    score: 0,
    phase: 'idle',
    lastPipe: 0,
    frame: 0,
  };
}

// ============================================================
// Drawing helpers
// ============================================================
function drawBackground(ctx: CanvasRenderingContext2D) {
  // Sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.7);
  sky.addColorStop(0, '#4fc3f7');
  sky.addColorStop(1, '#81d4fa');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H * 0.7);

  // Ground
  ctx.fillStyle = '#8d6e63';
  ctx.fillRect(0, H * 0.7, W, H * 0.3);
  ctx.fillStyle = '#a5d6a7';
  ctx.fillRect(0, H * 0.7, W, 18);

  // Clouds (static decorative)
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  [{ x: 60, y: 80 }, { x: 200, y: 50 }, { x: 360, y: 100 }].forEach(c => {
    ctx.beginPath();
    ctx.arc(c.x, c.y, 30, 0, Math.PI * 2);
    ctx.arc(c.x + 30, c.y - 10, 22, 0, Math.PI * 2);
    ctx.arc(c.x + 55, c.y, 28, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawPipes(ctx: CanvasRenderingContext2D, pipes: Pipe[]) {
  pipes.forEach(p => {
    // Top pipe
    ctx.fillStyle = '#43a047';
    ctx.fillRect(p.x, 0, PIPE_WIDTH, p.topH);
    // Top pipe cap
    ctx.fillStyle = '#388e3c';
    ctx.fillRect(p.x - 4, p.topH - 20, PIPE_WIDTH + 8, 20);

    // Bottom pipe
    const botY = p.topH + PIPE_GAP;
    ctx.fillStyle = '#43a047';
    ctx.fillRect(p.x, botY, PIPE_WIDTH, H - botY);
    // Bottom pipe cap
    ctx.fillStyle = '#388e3c';
    ctx.fillRect(p.x - 4, botY, PIPE_WIDTH + 8, 20);
  });
}

function drawBird(ctx: CanvasRenderingContext2D, y: number, frame: number) {
  const bx = 120;
  const by = y;
  const wingAngle = Math.sin(frame * 0.3) * 0.4;

  ctx.save();
  ctx.translate(bx, by);

  // Body
  ctx.fillStyle = '#fdd835';
  ctx.beginPath();
  ctx.ellipse(0, 0, 18, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f9a825';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Wing
  ctx.fillStyle = '#ffca28';
  ctx.save();
  ctx.rotate(-wingAngle);
  ctx.beginPath();
  ctx.ellipse(-6, 2, 10, 6, Math.PI * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Eye
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(8, -4, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a237e';
  ctx.beginPath();
  ctx.arc(9, -4, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Beak
  ctx.fillStyle = '#ff6f00';
  ctx.beginPath();
  ctx.moveTo(16, -1);
  ctx.lineTo(24, 2);
  ctx.lineTo(16, 5);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawScore(ctx: CanvasRenderingContext2D, score: number) {
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 36px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 4;
  ctx.fillText(String(score), W / 2, 60);
  ctx.shadowBlur = 0;
}

function checkCollision(birdY: number, pipes: Pipe[]): boolean {
  const bx = 120;
  const br = 14; // bird radius

  // Ground / ceiling
  if (birdY + br > H * 0.7 || birdY - br < 0) return true;

  for (const p of pipes) {
    if (bx + br > p.x && bx - br < p.x + PIPE_WIDTH) {
      if (birdY - br < p.topH || birdY + br > p.topH + PIPE_GAP) {
        return true;
      }
    }
  }
  return false;
}

// ============================================================
// App component
// ============================================================
export default function App({ config }: { config: AppConfig }) {
  const [me, setMe] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    currentEmail()
      .then(setMe)
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div style={styles.center}>
        <div style={styles.spinner} />
      </div>
    );
  }
  if (!me) {
    return <SignIn onSignedIn={setMe} />;
  }
  return <Game me={me} onSignOut={async () => { await signOut(); setMe(null); }} />;
}

// ============================================================
// Sign In
// ============================================================
function SignIn({ onSignedIn }: { onSignedIn: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await signIn(email, pw);
      const who = await currentEmail();
      onSignedIn(who ?? email);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.center}>
      <div style={styles.card}>
        <div style={styles.birdLogo}>🐦</div>
        <h1 style={styles.title}>Flappy Bird</h1>
        <p style={styles.sub}>Live Global Leaderboard</p>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={styles.input}
          />
          <input
            type="password"
            placeholder="Password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            required
            style={styles.input}
          />
          <button type="submit" disabled={busy} style={styles.btn}>
            {busy ? 'Signing in…' : 'Play →'}
          </button>
          {err && <p style={{ color: '#ff5252', fontSize: 13, margin: 0 }}>{err}</p>}
        </form>
        <p style={{ color: '#90a4ae', fontSize: 12, marginTop: 8, textAlign: 'center' }}>
          Accounts provisioned by administrator
        </p>
      </div>
    </div>
  );
}

// ============================================================
// Game
// ============================================================
function Game({ me, onSignOut }: { me: string; onSignOut: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState>(makeInitialState());
  const rafRef = useRef<number>(0);

  const [overlay, setOverlay] = useState<'idle' | 'dead' | null>('idle');
  const [lastScore, setLastScore] = useState(0);
  const [topScores, setTopScores] = useState<ScoreEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [username, setUsername] = useState(me.split('@')[0] ?? 'player');
  const [submitErr, setSubmitErr] = useState('');

  const loadLeaderboard = useCallback(async () => {
    try {
      const scores = await getTopScores(10);
      setTopScores(scores);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadLeaderboard();
  }, [loadLeaderboard]);

  // Game loop
  const tick = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const s = stateRef.current;

    if (s.phase === 'playing') {
      // Physics
      s.birdVy += GRAVITY;
      s.birdY += s.birdVy;
      s.frame += 1;

      // Spawn pipes
      const now = Date.now();
      if (now - s.lastPipe > PIPE_INTERVAL) {
        const topH = 80 + Math.random() * (H * 0.7 - PIPE_GAP - 80);
        s.pipes.push({ x: W + PIPE_WIDTH, topH, passed: false });
        s.lastPipe = now;
      }

      // Move pipes & score
      s.pipes = s.pipes.filter(p => p.x > -PIPE_WIDTH - 10);
      s.pipes.forEach(p => {
        p.x -= PIPE_SPEED;
        if (!p.passed && p.x + PIPE_WIDTH < 120) {
          p.passed = true;
          s.score += 1;
        }
      });

      // Collision
      if (checkCollision(s.birdY, s.pipes)) {
        s.phase = 'dead';
        setLastScore(s.score);
        setOverlay('dead');
        void loadLeaderboard();
      }
    }

    // Draw
    drawBackground(ctx);
    drawPipes(ctx, s.pipes);
    drawBird(ctx, s.birdY, s.frame);
    if (s.phase === 'playing' || s.phase === 'dead') {
      drawScore(ctx, s.score);
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [loadLeaderboard]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  const handleFlap = useCallback(() => {
    const s = stateRef.current;
    if (s.phase === 'idle') {
      s.phase = 'playing';
      s.lastPipe = Date.now();
      s.birdVy = JUMP_FORCE;
      setOverlay(null);
    } else if (s.phase === 'playing') {
      s.birdVy = JUMP_FORCE;
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        handleFlap();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleFlap]);

  const restart = () => {
    stateRef.current = makeInitialState();
    setOverlay('idle');
    setSubmitErr('');
  };

  const handleSubmitScore = async () => {
    setSubmitting(true);
    setSubmitErr('');
    try {
      await submitScore(lastScore, username);
      await loadLeaderboard();
    } catch (ex) {
      setSubmitErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.gameWrap}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>🐦 Flappy Bird</span>
        <span style={styles.headerUser}>
          {me} ·{' '}
          <span onClick={onSignOut} style={styles.link}>Sign out</span>
        </span>
      </div>

      {/* Canvas */}
      <div style={{ position: 'relative', lineHeight: 0 }}>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          onClick={handleFlap}
          style={{ display: 'block', cursor: 'pointer', maxWidth: '100%' }}
        />

        {/* Idle overlay */}
        {overlay === 'idle' && (
          <div style={styles.overlay}>
            <div style={styles.overlayCard}>
              <div style={{ fontSize: 64 }}>🐦</div>
              <h2 style={styles.overlayTitle}>Flappy Bird</h2>
              <p style={styles.overlaySub}>Click or press Space to flap!</p>
              <button onClick={handleFlap} style={styles.playBtn}>Play</button>
            </div>
          </div>
        )}

        {/* Game over overlay */}
        {overlay === 'dead' && (
          <div style={styles.overlay}>
            <div style={styles.overlayCard}>
              <h2 style={{ ...styles.overlayTitle, color: '#ff5252' }}>Game Over</h2>
              <p style={styles.overlaySub}>Score: <strong>{lastScore}</strong></p>

              {/* Submit score */}
              <div style={{ marginTop: 12 }}>
                <input
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="Your name"
                  style={{ ...styles.input, marginBottom: 8, textAlign: 'center' }}
                  maxLength={30}
                />
                <button
                  onClick={handleSubmitScore}
                  disabled={submitting}
                  style={{ ...styles.btn, marginBottom: 8 }}
                >
                  {submitting ? 'Posting…' : '📤 Post to Leaderboard'}
                </button>
                {submitErr && <p style={{ color: '#ff5252', fontSize: 12 }}>{submitErr}</p>}
              </div>

              {/* Top 5 */}
              <div style={styles.topList}>
                <div style={styles.topListHeader}>🏆 Top 5</div>
                {topScores.slice(0, 5).map((s, i) => (
                  <div key={`${s.userId}-${s.createdAt}`} style={styles.topRow}>
                    <span style={styles.topRank}>{i + 1}</span>
                    <span style={styles.topName}>{s.username}</span>
                    <span style={styles.topScore}>{s.score}</span>
                  </div>
                ))}
                {topScores.length === 0 && (
                  <p style={{ color: '#90a4ae', fontSize: 13 }}>No scores yet — be first!</p>
                )}
              </div>

              <button onClick={restart} style={styles.restartBtn}>↺ Play Again</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Styles
// ============================================================
const styles = {
  center: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#1a1a2e',
  } as React.CSSProperties,
  spinner: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    border: '4px solid #4fc3f7',
    borderTopColor: 'transparent',
    animation: 'spin 0.8s linear infinite',
  } as React.CSSProperties,
  card: {
    background: '#16213e',
    border: '1px solid #0f3460',
    borderRadius: 16,
    padding: '32px 28px',
    width: 320,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  } as React.CSSProperties,
  birdLogo: { fontSize: 48, textAlign: 'center' as const },
  title: { color: '#e0f7fa', textAlign: 'center' as const, margin: 0, fontSize: 28, fontFamily: 'system-ui' },
  sub: { color: '#80cbc4', textAlign: 'center' as const, fontSize: 14, margin: 0 },
  input: {
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid #0f3460',
    background: '#0d1b2a',
    color: '#e0f7fa',
    fontSize: 15,
    outline: 'none',
    width: '100%',
  } as React.CSSProperties,
  btn: {
    padding: '11px 14px',
    borderRadius: 8,
    border: 'none',
    background: '#00b4d8',
    color: '#fff',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    width: '100%',
  } as React.CSSProperties,
  gameWrap: {
    minHeight: '100vh',
    background: '#1a1a2e',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    paddingTop: 8,
  } as React.CSSProperties,
  header: {
    width: '100%',
    maxWidth: W,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    color: '#e0f7fa',
    fontFamily: 'system-ui',
    fontSize: 14,
  } as React.CSSProperties,
  headerTitle: { fontWeight: 700, fontSize: 16 } as React.CSSProperties,
  headerUser: { color: '#80cbc4' } as React.CSSProperties,
  link: { cursor: 'pointer', color: '#00b4d8', textDecoration: 'underline' } as React.CSSProperties,
  overlay: {
    position: 'absolute' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  } as React.CSSProperties,
  overlayCard: {
    background: '#16213e',
    border: '1px solid #0f3460',
    borderRadius: 16,
    padding: '24px 28px',
    width: 300,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 8,
    boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
    fontFamily: 'system-ui',
  } as React.CSSProperties,
  overlayTitle: { color: '#e0f7fa', margin: 0, fontSize: 24 } as React.CSSProperties,
  overlaySub: { color: '#80cbc4', margin: 0, fontSize: 15 } as React.CSSProperties,
  playBtn: {
    padding: '10px 28px',
    borderRadius: 8,
    border: 'none',
    background: '#00b4d8',
    color: '#fff',
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: 4,
  } as React.CSSProperties,
  restartBtn: {
    padding: '10px 28px',
    borderRadius: 8,
    border: '1px solid #0f3460',
    background: 'transparent',
    color: '#80cbc4',
    fontSize: 15,
    cursor: 'pointer',
    marginTop: 8,
  } as React.CSSProperties,
  topList: {
    width: '100%',
    marginTop: 8,
    background: '#0d1b2a',
    borderRadius: 10,
    padding: '10px 12px',
  } as React.CSSProperties,
  topListHeader: {
    color: '#ffd700',
    fontWeight: 700,
    fontSize: 14,
    marginBottom: 8,
  } as React.CSSProperties,
  topRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 0',
    borderBottom: '1px solid #0f3460',
    fontSize: 13,
    color: '#e0f7fa',
  } as React.CSSProperties,
  topRank: { color: '#ffd700', fontWeight: 700, width: 20 } as React.CSSProperties,
  topName: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } as React.CSSProperties,
  topScore: { fontWeight: 700, color: '#4fc3f7' } as React.CSSProperties,
};
