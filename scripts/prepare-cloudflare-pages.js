'use strict';

const fs = require('node:fs');
const path = require('node:path');

const voicesDir = path.join(process.cwd(), 'assets', 'voices');
const modelName = 'dii_pt-BR.onnx';
const modelPath = path.join(voicesDir, modelName);
const manifestPath = path.join(voicesDir, modelName + '.parts.json');
const chunkBytes = 20 * 1024 * 1024; // 20 MiB, abaixo do limite de 25 MiB do Pages.
const maxAssetBytes = 25 * 1024 * 1024;

function verifyExistingChunks() {
  if (!fs.existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!Array.isArray(manifest.parts) || !manifest.parts.length ||
        !Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 60000000) return false;
    let total = 0;
    const prefix = modelName + '.part-';
    for (const name of manifest.parts) {
      if (typeof name !== 'string' || !name.startsWith(prefix) ||
          !/^[0-9]{3}$/.test(name.slice(prefix.length))) return false;
      const partPath = path.join(voicesDir, name);
      if (!fs.existsSync(partPath)) return false;
      const size = fs.statSync(partPath).size;
      if (!size || size > chunkBytes) return false;
      total += size;
    }
    return total === manifest.totalBytes;
  } catch (_) {
    return false;
  }
}

if (!fs.existsSync(modelPath)) {
  if (verifyExistingChunks()) {
    console.log('O modelo feminino já está dividido em partes válidas.');
    process.exit(0);
  }
  console.error('Não encontrei o modelo assets/voices/' + modelName + ' nem um conjunto válido de partes.');
  process.exit(1);
}

const modelInfo = fs.statSync(modelPath);
if (modelInfo.size <= maxAssetBytes) {
  console.log('O modelo já está abaixo do limite de 25 MiB; nenhuma divisão é necessária.');
  process.exit(0);
}

const model = fs.readFileSync(modelPath);
const parts = [];
let totalWritten = 0;

for (let offset = 0, index = 0; offset < model.length; offset += chunkBytes, index++) {
  const filename = modelName + '.part-' + String(index).padStart(3, '0');
  const partPath = path.join(voicesDir, filename);
  const chunk = model.subarray(offset, Math.min(offset + chunkBytes, model.length));
  fs.writeFileSync(partPath, chunk);
  const writtenSize = fs.statSync(partPath).size;
  if (writtenSize !== chunk.length || writtenSize > maxAssetBytes) {
    throw new Error('A parte ' + filename + ' não passou na validação de tamanho.');
  }
  parts.push(filename);
  totalWritten += writtenSize;
}

if (totalWritten !== modelInfo.size) {
  throw new Error('A divisão do modelo ficou incompleta; o arquivo original foi preservado.');
}

const manifest = {
  version: 1,
  totalBytes: modelInfo.size,
  chunkBytes,
  parts
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

// Só remove o original depois que todas as partes e o manifesto foram verificados.
fs.unlinkSync(modelPath);
console.log('Modelo dividido em ' + parts.length + ' partes; total de ' + totalWritten + ' bytes.');
