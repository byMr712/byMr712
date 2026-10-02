const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const username = 'byMr712';
  
  // 1. Получаем дату и время предыдущего коммита в текущем репозитории
  let lastCommitDate;
  try {
    const rawDate = execSync('git log -1 --format=%cI', { encoding: 'utf8' }).trim();
    if (rawDate) {
      lastCommitDate = new Date(rawDate).toISOString();
    }
  } catch (e) {
    console.error('Failed to get last commit date:', e.message);
  }

  // Если не удалось определить, берем последние 24 часа
  if (!lastCommitDate) {
    lastCommitDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  }

  console.log(`Searching for commits by ${username} since ${lastCommitDate}...`);

  const query = `
    query($login: String!, $since: GitTimestamp!) {
      user(login: $login) {
        repositories(first: 100, orderBy: {field: PUSHED_AT, direction: DESC}, ownerAffiliations: OWNER) {
          nodes {
            name
            pushedAt
            defaultBranchRef {
              target {
                ... on Commit {
                  history(first: 100, since: $since) {
                    nodes {
                      message
                      committedDate
                      author {
                        name
                        email
                        user {
                          login
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  let repoCommits = [];

  if (token) {
    try {
      const data = JSON.stringify({
        query: query,
        variables: {
          login: username,
          since: lastCommitDate
        }
      });

      const resBody = await new Promise((resolve, reject) => {
        const req = https.request('https://api.github.com/graphql', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'User-Agent': 'NodeJS-Script',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
          }
        }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve(body));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
      });

      const parsed = JSON.parse(resBody);
      const repos = parsed.data?.user?.repositories?.nodes || [];

      for (const repo of repos) {
        // Пропускаем сам репозиторий профиля, чтобы избежать рекурсии
        if (repo.name.toLowerCase() === username.toLowerCase()) continue;

        const historyNodes = repo.defaultBranchRef?.target?.history?.nodes || [];
        const userCommits = historyNodes.filter(c => {
          const authorLogin = c.author?.user?.login;
          const authorName = c.author?.name || '';
          if (authorLogin && authorLogin.toLowerCase().includes('bot')) return false;
          if (authorName.toLowerCase().includes('[bot]')) return false;
          return authorLogin === username || !authorLogin;
        });

        const validMessages = [];
        for (const c of userCommits) {
          if (!c.message) continue;
          // Берем первую непустую строку (заголовок коммита)
          const firstLine = c.message.split('\n')[0].trim();
          if (firstLine.length > 0) {
            validMessages.push(firstLine);
          }
        }

        if (validMessages.length > 0) {
          repoCommits.push({
            name: repo.name,
            commits: validMessages
          });
        }
      }
    } catch (err) {
      console.error('Error fetching GraphQL commits:', err.message);
    }
  }

  // Формируем итоговое сообщение коммита
  let commitTitle = 'Auto-update profile stats and catalog [skip ci]';
  let commitBody = '';

  if (repoCommits.length > 0) {
    const sections = [];
    for (const item of repoCommits) {
      // Строго проверяем, что коммиты есть
      if (item.commits && item.commits.length > 0) {
        const lines = [`# ${item.name}`];
        for (const msg of item.commits) {
          lines.push(`- Commit: ${msg}`);
        }
        sections.push(lines.join('\n'));
      }
    }
    if (sections.length > 0) {
      commitBody = sections.join('\n\n');
    }
  }

  const fullMessage = commitBody ? `${commitTitle}\n\n${commitBody}\n` : `${commitTitle}\n`;
  fs.writeFileSync('.commit_msg.txt', fullMessage, 'utf8');
  console.log('Generated commit message:');
  console.log(fullMessage);
}

main();
