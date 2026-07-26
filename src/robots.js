function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&').replace(/\*/g, '.*');
}

function parseGroups(text) {
  const groups = [];
  let currentAgents = [];
  let currentRules = [];
  let hasRules = false;

  const commit = () => {
    if (currentAgents.length) groups.push({ agents: currentAgents, rules: currentRules });
    currentAgents = [];
    currentRules = [];
    hasRules = false;
  };

  for (const originalLine of String(text || '').split(/\r?\n/)) {
    const line = originalLine.replace(/#.*/, '').trim();
    if (!line) continue;

    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const directive = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (directive === 'user-agent') {
      // Consecutive User-agent lines belong to one group. A new user agent
      // after rules starts the next group.
      if (hasRules) commit();
      if (value) currentAgents.push(value.toLowerCase());
      continue;
    }

    if ((directive === 'allow' || directive === 'disallow') && currentAgents.length) {
      currentRules.push({ type: directive, path: value });
      hasRules = true;
    }
  }
  commit();
  return groups;
}

function ruleMatches(path, rulePath) {
  if (rulePath === '') return false; // An empty Disallow permits everything.
  const anchored = rulePath.endsWith('$');
  const pattern = anchored ? rulePath.slice(0, -1) : rulePath;
  const expression = `^${escapeRegex(pattern)}${anchored ? '$' : ''}`;
  return new RegExp(expression).test(path);
}

/**
 * Returns whether a URL is allowed for a named crawler according to a
 * robots.txt body. A missing/empty robots file therefore allows the URL.
 */
export function isAllowedByRobots(robotsText, url, userAgent = 'shortdramascraper') {
  const requestedUrl = url instanceof URL ? url : new URL(url);
  const crawler = userAgent.toLowerCase();
  const groups = parseGroups(robotsText);

  let strongestMatch = 0;
  let applicableRules = [];
  for (const group of groups) {
    const matchingAgentLength = group.agents.reduce((best, agent) => {
      if (agent === '*' && best === 0) return 1;
      if (agent !== '*' && crawler.includes(agent)) return Math.max(best, agent.length);
      return best;
    }, 0);

    if (matchingAgentLength > strongestMatch) {
      strongestMatch = matchingAgentLength;
      applicableRules = [...group.rules];
    } else if (matchingAgentLength !== 0 && matchingAgentLength === strongestMatch) {
      applicableRules.push(...group.rules);
    }
  }

  const target = `${requestedUrl.pathname}${requestedUrl.search}`;
  let winner = null;
  for (const rule of applicableRules) {
    if (!ruleMatches(target, rule.path)) continue;
    const specificity = rule.path.replace(/\*/g, '').replace(/\$$/, '').length;
    if (
      !winner ||
      specificity > winner.specificity ||
      (specificity === winner.specificity && rule.type === 'allow')
    ) {
      winner = { ...rule, specificity };
    }
  }

  return winner?.type !== 'disallow';
}
