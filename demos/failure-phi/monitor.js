/**
 * Phi-Accrual Failure Detector Monitor
 * - Interpretation: Uses a sliding window of historical intervals to calculate mean and variance. 
 *   Calculates Phi (φ) value based on the current interval using normal distribution CDF.
 * - Action: Mark as suspect/down if φ > threshold.
 */

const WINDOW_SIZE = 10; // Number of recorded intervals
const PHI_THRESHOLD = 40; // High threshold value set by user

function onUp() {
    let s = loadState();
    if (!s.targets || !s.outbox) {
        dumpState({
            targets: {},
            outbox: []
        });
    }
}

function processOutbox(s) {
    if (s.outbox && s.outbox.length > 0) {
        const msg = s.outbox.shift();
        sendMessage(msg.to, msg.payload);
    }
}

// Standard Error Function (ERF) approximation for normal distribution
function erf(x) {
    const sign = (x >= 0) ? 1 : -1;
    x = Math.abs(x);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
}

function calculatePhi(tDiff, mean, stdDev) {
    // Prevent divide by zero if stdDev is extremely small
    const sigma = Math.max(stdDev, 1.0);

    const z = (tDiff - mean) / sigma;
    let phi;

    if (z > 4.0) {
        phi = ((z * z / 2.0) + Math.log(z * Math.sqrt(2 * Math.PI))) / Math.LN10;
    } else if (z > 0) {
        const cdf = 0.5 * (1 + Math.sign(z / Math.sqrt(2)) * erf(Math.abs(z / Math.sqrt(2))));
        let p_late = 1.0 - cdf;
        if (p_late <= 1e-10) p_late = 1e-10;
        if (p_late >= 1.0) p_late = 1.0;
        phi = -Math.log10(p_late);
    } else {
        phi = 0.0;
    }

    return Math.min(phi, 100.0);
}

function onTimer(tick) {
    let s = loadState();
    s.tick = tick;

    // Iterate over all known targets to calculate their current φ value
    for (const [idStr, target] of Object.entries(s.targets)) {
        // Can't calculate anything without history
        if (target.intervals.length < 2) continue;

        // Calculate Mean & Variance of window
        let sum = 0;
        for (let i = 0; i < target.intervals.length; i++) sum += target.intervals[i];
        const mean = sum / target.intervals.length;

        let varianceSum = 0;
        for (let i = 0; i < target.intervals.length; i++) {
            varianceSum += Math.pow(target.intervals[i] - mean, 2);
        }
        const variance = varianceSum / target.intervals.length;
        // In local demo without real network jitter, heartbeats arrive perfectly on time (variance 0).
        // If we drop messages, intervals jump (e.g., 10, 10, 20).
        // Larger interval variance = lower Phi confidence calculation (correct for real networks).
        // We enforce a minimum standard deviation exactly like before to avoid divide-by-zero, but let it grow naturally.
        const stdDev = Math.max(Math.sqrt(variance), 1.0);

        // Calculate current Time since last heartbeat
        const tDiff = tick - target.lastArrival;

        // Determine Phi
        const phi = calculatePhi(tDiff, mean, stdDev);
        target.phi = phi; // Store for visual inspection in UI

        // ACTION
        if (phi > PHI_THRESHOLD) {
            target.status = 'down';
        } else {
            target.status = 'up'; // Auto-recovery if delay suddenly shrinks
        }
    }

    processOutbox(s);
    dumpState(s);
}

function onMessage(message) {
    let s = loadState();
    const m = message.payload;
    const sender = m.from !== undefined ? m.from : message.from;

    if (m.type === 'HEARTBEAT') {
        if (!s.targets[sender]) {
            // Pre-seed window simulating actual network latency characteristics from engine.js.
            // Target sends every 10 ticks (HEARTBEAT_INTERVAL). Engine adds `getRandom(1, 5)`.
            // The arrival interval is: (Next Send + Next Latency) - (Prev Send + Prev Latency)
            // Interval = HEARTBEAT_INTERVAL + Next Latency - Prev Latency
            const mockIntervals = [];
            let prevDelay = getRandom(1, 5);
            for (let i = 0; i < WINDOW_SIZE; i++) {
                const nextDelay = getRandom(1, 5);
                mockIntervals.push(10 + nextDelay - prevDelay);
                prevDelay = nextDelay;
            }

            s.targets[sender] = {
                intervals: mockIntervals,
                lastArrival: null,
                status: 'up',
                phi: 0.0
            };
        }

        const target = s.targets[sender];

        // Calculate interval and update sliding window
        if (target.lastArrival !== null) {
            const interval = s.tick - target.lastArrival;
            target.intervals.push(interval);
            if (target.intervals.length > WINDOW_SIZE) {
                target.intervals.shift(); // Remove oldest
            }
        }

        // Update last arrival and status
        target.lastArrival = s.tick;
        target.status = 'up';
        target.phi = 0.0;
    }

    processOutbox(s);
    dumpState(s);
}
