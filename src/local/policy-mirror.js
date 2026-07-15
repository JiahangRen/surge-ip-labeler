function normalizeSnapshot(content) {
  return String(content || '').replace(/^\uFEFF/, '').trim();
}

function countPolicies(content) {
  return content
    .split(/\r?\n/)
    .filter((line) => /^\s*[^#;\s][^=]*=\s*[^\s,]+\s*,/.test(line))
    .length;
}

export function buildValidationProfile(policyContent) {
  return [
    '[Proxy]',
    policyContent,
    '',
    '[Proxy Group]',
    '__IP_LABEL_VALIDATION__ = select, DIRECT',
    '',
    '[Rule]',
    'FINAL,DIRECT',
    '',
  ].join('\n');
}

export async function syncSnapshot({ fetchSnapshot, validate, writeAtomic, outputPath }) {
  const content = normalizeSnapshot(await fetchSnapshot());
  const policyCount = countPolicies(content);
  if (policyCount === 0) throw new Error('Worker response contains no Surge proxy policies');

  const validation = await validate(buildValidationProfile(content));
  if (!validation?.ok) throw new Error(validation?.error || 'surge-cli validation failed');

  await writeAtomic(outputPath, `${content}\n`);
  return { policyCount };
}
