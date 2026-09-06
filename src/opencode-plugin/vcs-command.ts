/** Recognize direct Git/GitHub commands without matching quoted prose or arguments. */
export function vcsCommandTypes(command: string): Set<'git' | 'github'> {
  const tokens = command.match(/"(?:\\.|[^"\\])*"|'[^']*'|[\n;&|]+|[^\s;&|]+/g) ?? [];
  const result = new Set<'git' | 'github'>();
  let start = true;
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i]!;
    if (/^[\n;&|]+$/.test(raw)) { start = true; continue; }
    if (!start) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(raw)) continue;
    start = false;
    const executable = raw.replace(/^['"]|['"]$/g, '').split('/').pop();
    if (executable !== 'git' && executable !== 'gh') continue;
    let j = i + 1;
    while (tokens[j]?.startsWith('-') === true) {
      const option = tokens[j++]!;
      if (['-C', '-c', '--git-dir', '--work-tree', '-R', '--repo', '--hostname'].includes(option)) j++;
    }
    const subcommand = tokens[j];
    if (executable === 'git' && subcommand !== undefined && ['log', 'show', 'blame'].includes(subcommand)) result.add('git');
    if (executable === 'gh' && subcommand !== undefined && ['pr', 'api'].includes(subcommand)) result.add('github');
  }
  return result;
}
