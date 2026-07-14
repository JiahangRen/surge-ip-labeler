function isPolicyLine(line) {
  const trimmed = line.trim();
  return trimmed.length > 0 && !trimmed.startsWith('#') && !trimmed.startsWith(';');
}

function sanitizeName(value) {
  return String(value).replace(/[\r\n]+/g, ' ').replaceAll('=', '＝').trim();
}

function getIntelValue(intel, ...keys) {
  for (const key of keys) {
    if (intel[key] !== undefined && intel[key] !== null) return intel[key];
  }
  return undefined;
}

function formatScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 100) return '评分未知';

  const display = Number.isInteger(score) ? String(score) : String(score);
  if (score >= 80) return `🟢${display}`;
  if (score >= 50) return `🟡${display}`;
  return `🔴${display}`;
}

function formatNative(value) {
  if (value === true) return '原生IP';
  if (value === false) return '非原生IP';
  return '原生未知';
}

function formatResidential(value) {
  if (value === true) return '住宅';
  if (value === false) return '非住宅';
  return '住宅未知';
}

function formatHuman(value) {
  if (value === true) return '爬虫偏多';
  if (value === false) return '人类偏多';
  return '人类未知';
}

export function parsePolicyFeed(text) {
  return String(text).split(/\r\n|\n|\r/).map((line) => {
    if (!isPolicyLine(line)) return { type: 'preserved', line };

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) return { type: 'preserved', line };

    const originalName = line.slice(0, separatorIndex).trim();
    const descriptor = line.slice(separatorIndex + 1);
    if (!originalName || !descriptor.trim()) return { type: 'preserved', line };

    const nameStart = line.indexOf(originalName);
    return {
      type: 'policy',
      name: originalName,
      descriptor,
      separator: line.slice(nameStart + originalName.length, separatorIndex + 1),
    };
  });
}

export function formatLabel(name, exitIp, intel = {}) {
  const ip = typeof exitIp === 'string' && exitIp.trim() ? exitIp.trim() : 'IP:未知';
  const trustScore = getIntelValue(intel, 'trust_score', 'trustScore', 'score');
  const native = getIntelValue(intel, 'native', 'is_native', 'isNative');
  const residential = getIntelValue(intel, 'isResidential', 'is_residential', 'residential');
  const crawler = getIntelValue(intel, 'is_crawler', 'isCrawler', 'crawler');

  return [
    `${sanitizeName(name)} [${ip}]`,
    formatScore(trustScore),
    formatNative(native),
    formatResidential(residential),
    formatHuman(crawler),
  ].join(' | ');
}

export function renderPolicyLine(node, label) {
  if (node.type !== 'policy') return node.line;
  return `${sanitizeName(label)}${node.separator}${node.descriptor}`;
}
