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

function normalizedCountryCode(value) {
  return typeof value === 'string' && /^[a-z]{2}$/i.test(value.trim()) ? value.trim().toUpperCase() : '';
}

function formatNative(value, intel) {
  if (value === true) return '原生IP';
  if (value === false) return '非原生IP';
  const country = normalizedCountryCode(getIntelValue(intel, 'countryCode', 'country_code'));
  const registered = normalizedCountryCode(getIntelValue(intel, 'registered_country_code', 'registeredCountryCode'));
  if (country && registered && country !== registered) return `广播IP (${registered})`;
  if (
    country
    && country === registered
    && intel.isResidential === true
    && intel.is_vpn !== true
    && intel.is_proxy !== true
  ) return '原生IP';
  return '';
}

function formatResidential(value, intel) {
  if (value === true) return '住宅';
  if (intel.is_datacenter === true || /^(hosting|datacenter)$/i.test(String(intel.company_type || ''))) return '机房IP';
  if (value === false) return '非住宅';
  return '';
}

function formatHuman(value) {
  if (value === true) return '机器偏多';
  if (value === false) return '人类偏多';
  return '';
}

function hasAbuseHistory(intel) {
  if (intel.is_abuser === true) return true;
  const level = String(intel.intelligence?.abuser_level || intel.abuser_level || '').toLowerCase();
  return ['medium', 'high', 'critical', 'severe'].includes(level);
}

function formatGptScore(intel) {
  const verdict = intel.ai_verdict;
  if (!verdict || typeof verdict !== 'object') return '';
  const confidence = Number(verdict.confidence);
  const label = typeof verdict.label === 'string' ? verdict.label.trim() : '';
  if (!Number.isFinite(confidence)) return '';
  const display = Number.isInteger(confidence) ? String(confidence) : String(confidence);
  return label ? `GPT评分:${display} (${label})` : `GPT评分:${display}`;
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
  const intelData = intel !== null && typeof intel === 'object' ? intel : {};
  const trustScore = getIntelValue(intelData, 'trust_score', 'trustScore', 'score');
  const native = getIntelValue(intelData, 'native', 'is_native', 'isNative');
  const residential = getIntelValue(intelData, 'isResidential', 'is_residential', 'residential');
  const crawler = getIntelValue(intelData, 'is_crawler', 'isCrawler', 'crawler');
  const labels = [
    `${sanitizeName(name)} [${ip}]`,
    formatScore(trustScore),
    formatNative(native, intelData),
    formatResidential(residential, intelData),
  ];
  if (hasAbuseHistory(intelData)) labels.push('历史滥用');
  labels.push(formatHuman(crawler));
  labels.push(formatGptScore(intelData));

  return labels.filter(Boolean).join(' | ');
}

export function renderPolicyLine(node, label) {
  if (node.type !== 'policy') return node.line;
  return `${sanitizeName(label)}${node.separator}${node.descriptor}`;
}
