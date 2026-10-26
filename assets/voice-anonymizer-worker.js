'use strict';

const DEFAULT_ORDER = 16;
const FRAME_MS = 20;
const HOP_MS = 10;

function autocorrelationLpc(frame, order) {
  const n = frame.length;
  const r = new Float64Array(order + 1);
  for (let lag = 0; lag <= order; lag++) {
    let sum = 0;
    for (let i = lag; i < n; i++) sum += frame[i] * frame[i - lag];
    r[lag] = sum / n;
  }
  if (!Number.isFinite(r[0]) || r[0] < 1e-9) return null;

  const a = new Float64Array(order + 1);
  const previous = new Float64Array(order + 1);
  a[0] = 1;
  let error = r[0];

  for (let i = 1; i <= order; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    let reflection = -acc / Math.max(error, 1e-12);
    if (!Number.isFinite(reflection)) return null;
    reflection = Math.max(-0.985, Math.min(0.985, reflection));

    previous.set(a);
    for (let j = 1; j < i; j++) a[j] = previous[j] + reflection * previous[i - j];
    a[i] = reflection;
    error *= 1 - reflection * reflection;
    if (!Number.isFinite(error) || error < r[0] * 1e-7) break;
  }

  for (let i = 0; i <= order; i++) if (!Number.isFinite(a[i])) return null;
  return a;
}

function evaluatePolynomialAndDerivative(coefficients, zr, zi) {
  let pr = coefficients[0], pi = 0;
  let dr = 0, di = 0;
  for (let i = 1; i < coefficients.length; i++) {
    const nextDr = dr * zr - di * zi + pr;
    const nextDi = dr * zi + di * zr + pi;
    const nextPr = pr * zr - pi * zi + coefficients[i];
    const nextPi = pr * zi + pi * zr;
    dr = nextDr;
    di = nextDi;
    pr = nextPr;
    pi = nextPi;
  }
  return { pr, pi, dr, di };
}

function polynomialRoots(coefficients) {
  const degree = coefficients.length - 1;
  if (degree < 1 || degree > 32 || !Number.isFinite(coefficients[0]) || Math.abs(coefficients[0]) < 1e-12) {
    return null;
  }

  // Aberth-Ehrlich converges all roots together and is much more robust here
  // than the previous 100-iteration Durand-Kerner approximation.
  let cauchyBound = 1;
  for (let i = 1; i < coefficients.length; i++) {
    cauchyBound = Math.max(cauchyBound, 1 + Math.abs(coefficients[i] / coefficients[0]));
  }
  const initialRadius = Math.max(1.05, Math.min(2.5, cauchyBound));
  const real = new Float64Array(degree);
  const imag = new Float64Array(degree);
  const nextReal = new Float64Array(degree);
  const nextImag = new Float64Array(degree);

  for (let i = 0; i < degree; i++) {
    const angle = (2 * Math.PI * (i + 0.1732050807) / degree) + 0.017 * Math.sin(i * 13.37);
    real[i] = initialRadius * Math.cos(angle);
    imag[i] = initialRadius * Math.sin(angle);
  }

  let converged = false;
  for (let iteration = 0; iteration < 600; iteration++) {
    let maxStep = 0;
    for (let i = 0; i < degree; i++) {
      const evaluated = evaluatePolynomialAndDerivative(coefficients, real[i], imag[i]);
      const derivativeNorm = evaluated.dr * evaluated.dr + evaluated.di * evaluated.di;
      if (!Number.isFinite(derivativeNorm) || derivativeNorm < 1e-28) return null;

      const newtonReal = (evaluated.pr * evaluated.dr + evaluated.pi * evaluated.di) / derivativeNorm;
      const newtonImag = (evaluated.pi * evaluated.dr - evaluated.pr * evaluated.di) / derivativeNorm;
      let sumReal = 0, sumImag = 0;

      for (let j = 0; j < degree; j++) {
        if (j === i) continue;
        const dx = real[i] - real[j];
        const dy = imag[i] - imag[j];
        const denominator = dx * dx + dy * dy;
        if (denominator < 1e-24) continue;
        sumReal += dx / denominator;
        sumImag -= dy / denominator;
      }

      const productReal = newtonReal * sumReal - newtonImag * sumImag;
      const productImag = newtonReal * sumImag + newtonImag * sumReal;
      const correctionDenominatorReal = 1 - productReal;
      const correctionDenominatorImag = -productImag;
      const correctionDenominatorNorm =
        correctionDenominatorReal * correctionDenominatorReal +
        correctionDenominatorImag * correctionDenominatorImag;

      let correctionReal = newtonReal;
      let correctionImag = newtonImag;
      if (Number.isFinite(correctionDenominatorNorm) && correctionDenominatorNorm > 1e-20) {
        correctionReal = (
          newtonReal * correctionDenominatorReal + newtonImag * correctionDenominatorImag
        ) / correctionDenominatorNorm;
        correctionImag = (
          newtonImag * correctionDenominatorReal - newtonReal * correctionDenominatorImag
        ) / correctionDenominatorNorm;
      }

      if (!Number.isFinite(correctionReal) || !Number.isFinite(correctionImag)) return null;
      nextReal[i] = real[i] - correctionReal;
      nextImag[i] = imag[i] - correctionImag;
      maxStep = Math.max(maxStep, Math.hypot(correctionReal, correctionImag));
    }

    real.set(nextReal);
    imag.set(nextImag);
    if (maxStep < 1e-9) {
      converged = true;
      break;
    }
  }

  // A scale-independent residual check allows a valid result even when the
  // final step is just above the strict convergence tolerance.
  let maxRelativeResidual = 0;
  for (let i = 0; i < degree; i++) {
    const evaluated = evaluatePolynomialAndDerivative(coefficients, real[i], imag[i]);
    const magnitude = Math.hypot(real[i], imag[i]);
    let scale = 0;
    for (let k = 0; k < coefficients.length; k++) {
      scale += Math.abs(coefficients[k]) * Math.pow(magnitude, degree - k);
    }
    const relativeResidual = Math.hypot(evaluated.pr, evaluated.pi) / Math.max(scale, 1e-30);
    if (!Number.isFinite(relativeResidual)) return null;
    maxRelativeResidual = Math.max(maxRelativeResidual, relativeResidual);
  }

  if ((!converged && maxRelativeResidual > 1e-8) || maxRelativeResidual > 1e-7) return null;
  return { real, imag };
}

function coefficientsFromRoots(roots, alpha) {
  const count = roots.real.length;
  const used = new Uint8Array(count);
  const factors = [];

  for (let i = 0; i < count; i++) {
    if (used[i]) continue;
    const x = roots.real[i];
    const y = roots.imag[i];
    const radius = Math.hypot(x, y);
    if (!Number.isFinite(radius) || radius < 0.05 || radius >= 1.002) return null;

    if (Math.abs(y) < 1e-5) {
      used[i] = 1;
      factors.push([1, -x]);
      continue;
    }

    let partner = -1;
    let bestDistance = Infinity;
    for (let j = 0; j < count; j++) {
      if (used[j] || j === i || Math.sign(roots.imag[j]) === Math.sign(y)) continue;
      const distance = Math.hypot(roots.real[j] - x, roots.imag[j] + y);
      if (distance < bestDistance) {
        bestDistance = distance;
        partner = j;
      }
    }

    const pairingTolerance = 2e-3 * Math.max(1, radius);
    if (partner < 0 || bestDistance > pairingTolerance) return null;
    used[i] = 1;
    used[partner] = 1;

    const partnerRadius = Math.hypot(roots.real[partner], roots.imag[partner]);
    if (!Number.isFinite(partnerRadius) || Math.abs(partnerRadius - radius) > pairingTolerance) return null;
    const meanRadius = (radius + partnerRadius) / 2;
    const angle = Math.atan2(Math.abs(y) + Math.abs(roots.imag[partner]), x + roots.real[partner]) / 2;
    const warpedAngle = Math.pow(Math.max(0, angle), alpha);
    if (!Number.isFinite(warpedAngle)) return null;

    // Build a real-valued quadratic directly from each conjugate pole pair.
    factors.push([
      1,
      -2 * meanRadius * Math.cos(warpedAngle),
      meanRadius * meanRadius
    ]);
  }

  let coefficients = [1];
  for (const factor of factors) {
    const next = new Array(coefficients.length + factor.length - 1).fill(0);
    for (let i = 0; i < coefficients.length; i++) {
      for (let j = 0; j < factor.length; j++) next[i + j] += coefficients[i] * factor[j];
    }
    coefficients = next;
  }

  const result = Float64Array.from(coefficients);
  for (const value of result) if (!Number.isFinite(value)) return null;
  return result;
}

function mcadamsLpcCoefficients(lpc, alpha) {
  const roots = polynomialRoots(lpc);
  if (!roots) return null;
  return coefficientsFromRoots(roots, alpha);
}

function lfilterAnalysis(coefficients, frame) {
  const out = new Float64Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    let value = frame[i], limit = Math.min(coefficients.length - 1, i);
    for (let j = 1; j <= limit; j++) value += coefficients[j] * frame[i - j];
    out[i] = value;
  }
  return out;
}

function lfilterSynthesis(coefficients, residual) {
  const out = new Float64Array(residual.length);
  for (let i = 0; i < residual.length; i++) {
    let value = residual[i], limit = Math.min(coefficients.length - 1, i);
    for (let j = 1; j <= limit; j++) value -= coefficients[j] * out[i - j];
    out[i] = value;
  }
  return out;
}

function processSpeech(input, sampleRate, strength) {
  if (!(input instanceof Float32Array) || !input.length) throw new Error('A gravação está vazia.');
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new Error('A frequência do áudio não é compatível com o filtro.');
  }
  if (input.length > sampleRate * 120) throw new Error('Para manter o processamento estável no celular, grave áudios de até 2 minutos.');

  const bands = { subtle: [0.80, 0.90], balanced: [0.65, 0.80], strong: [0.50, 0.65] };
  const band = bands[strength] || bands.balanced;
  const alpha = band[0] + Math.random() * (band[1] - band[0]);

  const winLength = Math.max(256, Math.round(sampleRate * FRAME_MS / 1000));
  const hop = Math.max(128, Math.round(sampleRate * HOP_MS / 1000));
  const leftPad = hop;
  const padded = new Float32Array(leftPad + input.length + winLength);
  padded.set(input, leftPad);

  const window = new Float64Array(winLength);
  let hannSum = 0;
  for (let i = 0; i < winLength; i++) {
    const value = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (winLength - 1));
    window[i] = value;
    hannSum += value;
  }
  const normalization = hannSum / hop;
  for (let i = 0; i < winLength; i++) window[i] = Math.sqrt(window[i] / normalization);

  const order = Math.min(DEFAULT_ORDER, Math.max(8, Math.floor(winLength / 30)));
  const frameCount = Math.floor((padded.length - winLength) / hop) + 1;
  const output = new Float64Array(padded.length);
  const frame = new Float64Array(winLength);
  let failedFrames = 0;

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const start = frameIndex * hop;
    let energy = 0;
    for (let i = 0; i < winLength; i++) {
      const value = padded[start + i] * window[i];
      frame[i] = value;
      energy += value * value;
    }

    let reconstructed = frame;
    if (energy > 1e-7) {
      const lpc = autocorrelationLpc(frame, order);
      const shifted = lpc ? mcadamsLpcCoefficients(lpc, alpha) : null;
      if (lpc && shifted) {
        reconstructed = lfilterSynthesis(shifted, lfilterAnalysis(lpc, frame));
      } else {
        failedFrames++;
      }
    }

    for (let i = 0; i < winLength; i++) output[start + i] += reconstructed[i] * window[i];
    if (frameIndex % 200 === 0 || frameIndex === frameCount - 1) {
      self.postMessage({ type: 'progress', percent: Math.round((frameIndex + 1) / frameCount * 100) });
    }
  }

  const result = new Float32Array(input.length);
  let peak = 0;
  for (let i = 0; i < input.length; i++) {
    const value = output[leftPad + i];
    if (!Number.isFinite(value)) throw new Error('O filtro encontrou um problema no áudio. Grave novamente.');
    result[i] = value;
    peak = Math.max(peak, Math.abs(value));
  }
  if (failedFrames > frameCount * 0.08) {
    throw new Error('Não consegui processar este áudio com qualidade suficiente. Tente gravar mais perto do microfone, em um ambiente silencioso.');
  }
  if (peak < 1e-5) throw new Error('Não detectei fala suficiente na gravação.');

  const gain = peak > 0.92 ? 0.92 / peak : Math.min(2.5, 0.72 / peak);
  for (let i = 0; i < result.length; i++) result[i] = Math.max(-0.98, Math.min(0.98, result[i] * gain));
  return { samples: result, alpha, failedFrames, frameCount };
}

self.onmessage = event => {
  const data = event.data || {};
  if (data.type !== 'anonymize') return;
  try {
    const samples = data.samples instanceof Float32Array ? data.samples : new Float32Array(data.samples);
    const result = processSpeech(samples, Number(data.sampleRate), String(data.strength || 'balanced'));
    self.postMessage({
      type: 'done',
      samples: result.samples.buffer,
      alpha: result.alpha,
      failedFrames: result.failedFrames,
      frameCount: result.frameCount
    }, [result.samples.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || 'Não foi possível aplicar o filtro de voz.' });
  }
};