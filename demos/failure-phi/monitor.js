// Failure Detection — Phi Accrual Monitor (Master)
// Tracks heartbeat intervals from targets and computes a phi score.
// Uses Gaussian Cumulative Distribution Function (CDF) for accurate probability.
// Pattern A — Plain Functions

const TARGET_IDS = allServerIds.filter(id => id !== 0);
const WINDOW_SIZE = 10;
const PHI_THRESHOLD = 8;
const MIN_STDDEV = 1.0;

/** ---------------- MATH HELPERS ---------------- **/

function erf(x) {
    const sign = (x >= 0) ? 1 : -1;
    x = Math.abs(x);
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
}

function computePhi(tDiff, history) {
    if (!history || history.length === 0) return 0;
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const variance = history.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / history.length;
    const stdDev = Math.sqrt(variance);
    const sigma = Math.max(stdDev, MIN_STDDEV);
    const z = (tDiff - mean) / sigma;
    let phi;
    if (z > 4.0) {
        phi = ((z * z / 2.0) + Math.log(z * Math.sqrt(2 * Math.PI))) / Math.LN10;
    } else if (z > 0) {
        const cdf = 0.5 * (1 + Math.sign(z / Math.sqrt(2)) * erf(Math.abs(z / Math.sqrt(2))));
        let p_late = 1.0 - cdf;
        if (p_late <= 1e-10) p_late = 1e-10;
        phi = -Math.log10(p_late);
    } else {
        phi = 0.0;
    }
    return Math.min(phi, 100.0);
}

function phiClassifier(phi) {
    if (phi > PHI_THRESHOLD) return 'DEAD';
    if (phi > 3) return 'SUSPICIOUS';
    return 'OK';
}

/** ---------------- HANDLERS ---------------- **/

function onUp() {
    const s = {
        intervals: {},
        lastSeen: {},
        anyDead: false,
        monitor_view: 'Waiting for heartbeats...'
    };

    // Jumpstart: Pre-seed history with fake statistics to avoid lengthy collection
    // Heartbeats arrive approximately every 10 ticks with 1-5 tick jitter.
    TARGET_IDS.forEach(id => {
        s.intervals[id] = [];
        let prevDelay = getRandom(1, 5);
        for (let i = 0; i < WINDOW_SIZE; i++) {
            const nextDelay = getRandom(1, 5);
            s.intervals[id].push(10 + nextDelay - prevDelay);
            prevDelay = nextDelay;
        }
        s.lastSeen[id] = 0;
    });

    dumpState(s);
}

function onTimer(t) {
    const s = loadState();
    let anyDead = false;

    const scores = TARGET_IDS.map(id => {
        const phi = computePhi(t - (s.lastSeen[id] || 0), s.intervals[id]);
        const status = phiClassifier(phi);
        if (status === 'DEAD') anyDead = true;

        return { id, phi: phi.toFixed(2), status };
    });

    s.anyDead = anyDead;
    s.ui_state = anyDead ? 'Failure Detected' : 'Monitoring';
    s.ui_color = anyDead ? '#e57373' : '#fff59d';
    s.monitor_view = scores.map(r => `${r.id}: φ=${r.phi} (${r.status})`).join(' | ');

    dumpState(s);
}

function onMessage(m) {
    if (m.payload.type === 'HEARTBEAT') {
        const s = loadState();
        const arrival = m.arrivalTick;
        const last = s.lastSeen[m.from];

        if (last !== undefined) {
            s.intervals[m.from].push(arrival - last);
            if (s.intervals[m.from].length > WINDOW_SIZE) s.intervals[m.from].shift();
        }

        s.lastSeen[m.from] = arrival;
        dumpState(s);
    }
}
