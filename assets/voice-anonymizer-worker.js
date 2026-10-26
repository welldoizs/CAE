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

function evaluatePolynomial(coefficients, zr, zi) {
  let real = coefficients[0], imag = 0;
  for (let i = 1; i < coefficients.length; i++) {
    const nextReal = real * zr - imag * zi + coefficients[i];
    const nextImag = real * zi + imag * zr;
    real = nextReal;
    imag = nextImag;
  }
  return [real, imag];
}

function polynomialRoots(coefficients) {
  const degree = coefficients.length - 1;
  const real = new Float64Array(degree), imag = new Float64Array(degree);
  const nextReal = new Float64Array(degree), nextImag = new Float64Array(degree);
  for (let i = 0; i < degree; i++) {
    const angle = 2 * Math.PI * (i + 0.371) / degree;
    const radius = 0.91 + 0.07 * ((i % 3) / 2);
    real[i] = radius * Math.cos(angle);
    imag[i] = radius * Math.sin(angle);
  }

  let converged = false;
  for (let iteration = 0; iteration < 100; iteration++) {
    let maxDelta = 0;
    for (let i = 0; i < degree; i++) {
      const [pr, pi] = evaluatePolynomial(coefficients, real[i], imag[i]);
      let dr = 1, di = 0;
      for (let j = 0; j < degree; j++) {
        if (j === i) continue;
        const xr = real[i] - real[j], xi = imag[i] - imag[j];
        const nr = dr * xr - di * xi, ni = dr * xi + di * xr;
        dr = nr; di = ni;
      }
      const denominator = dr * dr + di * di;
      if (!Number.isFinite(denominator) || denominator < 1e-24) return null;
      const deltaReal = (pr * dr + pi * di) / denominator;
      const deltaImag = (pi * dr - pr * di) / denominator;
      nextReal[i] = real[i] - deltaReal;
      nextImag[i] = imag[i] - deltaImag;
      maxDelta = Math.max(maxDelta, Math.hypot(deltaReal, deltaImag));
    }
    real.set(nextReal); imag.set(nextImag);
    if (maxDelta < 2e-7) { converged = true; break; }
  }

  if (!converged) {
    let residual = 0;
    for (let i = 0; i < degree; i++) {
      const [pr, pi] = evaluatePolynomial(coefficients, real[i], imag[i]);
      residual = Math.max(residual, Math.hypot(pr, pi));
    }
    if (!Number.isFinite(residual) || residual > 0.015) return null;
  }
  return { real, imag };
}

function coefficientsFromRoots(roots) {
  const n = roots.real.length;
  const real = new Float64Array(n + 1), imag = new Float64Array(n + 1);
  real[0] = 1;
  let used = 0;
  for (let i = 0; i < n; i++) {
    const nextReal = new Float64Array(n + 1), nextImag = new Float64Array(n + 1);
    for (let j = 0; j <= used; j++) {
      nextReal[j] += real[j];
      nextImag[j] += imag[j];
      nextReal[j + 1] -= real[j] * roots.real[i] - imag[j] * roots.imag[i];
      nextImag[j + 1] -= real[j] * roots.imag[i] + imag[j] * roots.real[i];
    }
    real.set(nextReal); imag.set(nextImag); used++;
  }
  const coefficients = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    if (!Number.isFinite(real[i]) || Math.abs(imag[i]) > 0.015) return null;
    coefficients[i] = real[i] / real[0];
  }
  return coefficients;
}

function mcadamsLpcCoefficients(lpc, alpha) {
  const roots = polynomialRoots(lpc);
  if (!roots) return null;
  for (let i = 0; i < roots.real.length; i++) {
    const radius = Math.hypot(roots.real[i], roots.imag[i]);
    if (!Number.isFinite(radius) || radius < 0.05 || radius >= 1.002) return null;
    const angle = Math.atan2(roots.imag[i], roots.real[i]);
    if (Math.abs(roots.imag[i]) < 1e-7) continue;
    const warpedAngle = Math.sign(angle) * Math.pow(Math.abs(angle), alpha);
    roots.real[i] = radius * Math.cos(warpedAngle);
    roots.imag[i] = radius * Math.sin(warpedAngle);
  }
  return coefficientsFromRoots(roots);
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