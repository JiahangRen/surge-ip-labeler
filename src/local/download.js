export async function downloadSnapshot({ url, runCurl }) {
  try {
    const { stdout } = await runCurl([
      '--noproxy', '*', '--fail', '--silent', '--show-error', '--max-time', '20', url,
    ]);
    return stdout;
  } catch {
    // The curl error message contains its full command line, including the private read token.
    throw new Error('Worker subscription download failed or timed out');
  }
}
