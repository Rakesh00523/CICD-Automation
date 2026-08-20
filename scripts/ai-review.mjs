// AI code review step for pull requests. Fetches the PR diff, asks Claude to
// review it for logic errors, security issues, and anti-patterns, then posts
// (or updates) a single PR comment with the result.
//
// Required env vars: ANTHROPIC_API_KEY, GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER
// Optional: CLAUDE_MODEL (default: claude-sonnet-5)

const COMMENT_MARKER = '<!-- ai-review-bot -->';
const MAX_DIFF_CHARS = 60000;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function githubRequest(path, { token, accept, method = 'GET', body } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept ?? 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${method} ${path} failed: ${res.status} ${await res.text()}`);
  }
  return accept === 'application/vnd.github.v3.diff' ? res.text() : res.json();
}

async function fetchDiff(repo, prNumber, token) {
  return githubRequest(`/repos/${repo}/pulls/${prNumber}`, {
    token,
    accept: 'application/vnd.github.v3.diff',
  });
}

async function findExistingComment(repo, prNumber, token) {
  const comments = await githubRequest(`/repos/${repo}/issues/${prNumber}/comments`, { token });
  return comments.find((c) => c.body?.includes(COMMENT_MARKER));
}

async function upsertComment(repo, prNumber, token, body) {
  const existing = await findExistingComment(repo, prNumber, token);
  if (existing) {
    await githubRequest(`/repos/${repo}/issues/comments/${existing.id}`, {
      token,
      method: 'PATCH',
      body: { body },
    });
  } else {
    await githubRequest(`/repos/${repo}/issues/${prNumber}/comments`, {
      token,
      method: 'POST',
      body: { body },
    });
  }
}

async function reviewWithClaude(apiKey, model, diff) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            'You are reviewing a pull request diff for an e-commerce application (React + Node/Express + MongoDB).',
            'Focus only on: logical errors/bugs, security vulnerabilities, and coding anti-patterns.',
            'Ignore style nits that a linter would already catch.',
            'For each issue: file/line if identifiable, a one-line description, and severity (High/Medium/Low).',
            'If you find nothing notable, say so briefly. Keep the whole review under 400 words, formatted as markdown.',
            '',
            'Diff:',
            '```diff',
            diff,
            '```',
          ].join('\n'),
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text ?? '(no response text)';
}

async function main() {
  const apiKey = requireEnv('ANTHROPIC_API_KEY');
  const githubToken = requireEnv('GITHUB_TOKEN');
  const repo = requireEnv('GITHUB_REPOSITORY');
  const prNumber = requireEnv('PR_NUMBER');
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

  let diff = await fetchDiff(repo, prNumber, githubToken);
  let truncated = false;
  if (diff.length > MAX_DIFF_CHARS) {
    diff = diff.slice(0, MAX_DIFF_CHARS);
    truncated = true;
  }

  if (!diff.trim()) {
    console.log('Empty diff, skipping AI review.');
    return;
  }

  const review = await reviewWithClaude(apiKey, model, diff);

  const body = [
    COMMENT_MARKER,
    '## 🤖 AI Code Review (Claude)',
    '',
    review,
    truncated ? '\n> Note: diff was truncated to fit the review context.' : '',
  ].join('\n');

  await upsertComment(repo, prNumber, githubToken, body);
  console.log('AI review comment posted.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
