const fs = require('fs');
const https = require('https');

const USERNAME = 'byMr712';

function fetchRepos(page = 1) {
  return new Promise((resolve, reject) => {
    const token = process.env.GITHUB_TOKEN;
    const headers = {
      'User-Agent': 'NodeJS-Catalog-Updater',
      'Accept': 'application/vnd.github+json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const options = {
      hostname: 'api.github.com',
      path: `/users/${USERNAME}/repos?per_page=100&page=${page}&type=public&sort=created&direction=asc`,
      headers: headers
    };

    https.get(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`GitHub API returned status ${res.statusCode}: ${body}`));
        }
        try {
          const json = JSON.parse(body);
          resolve(json);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function getAllRepos() {
  let page = 1;
  let allRepos = [];
  while (true) {
    const repos = await fetchRepos(page);
    if (!Array.isArray(repos) || repos.length === 0) break;
    allRepos = allRepos.concat(repos);
    if (repos.length < 100) break;
    page++;
  }
  return allRepos;
}

function classifyRepo(repo) {
  const name = repo.name;
  
  // 1. Minecraft Mod
  if (/-MinecraftMod$/i.test(name)) {
    const cleanName = name.replace(/-(\d+\.\d+(\.\d+)?-)?MinecraftMod$/i, '');
    return {
      category: 'MOD',
      cleanName: cleanName,
      repoName: name,
      url: repo.html_url,
      descriptionRu: repo.description || `Модификация ${cleanName} для Minecraft`,
      descriptionEn: repo.description ? `${cleanName} mod for Minecraft` : `${cleanName} mod for Minecraft`
    };
  }
  
  // 2. Minecraft Plugin
  if (/-MinecraftPlugin$/i.test(name)) {
    const cleanName = name.replace(/-MinecraftPlugin$/i, '');
    return {
      category: 'PLUGIN',
      cleanName: cleanName,
      repoName: name,
      url: repo.html_url,
      descriptionRu: repo.description || `Плагин ${cleanName} для Minecraft серверов`,
      descriptionEn: repo.description ? `${cleanName} plugin for Minecraft servers` : `${cleanName} plugin for Minecraft servers`
    };
  }

  // 3. CLI Utilities
  if (/^MR-CLI-/i.test(name)) {
    return {
      category: 'CLI',
      cleanName: name,
      repoName: name,
      url: repo.html_url,
      descriptionRu: repo.description || `Консольная утилита ${name}`,
      descriptionEn: repo.description || `Command-line utility ${name}`
    };
  }

  return null;
}

function insertRowIntoSection(content, sectionHeaderRegex, newRow) {
  // Находим секцию от sectionHeaderRegex до следующего </details>
  const headerMatch = content.match(sectionHeaderRegex);
  if (!headerMatch) return content;

  const headerIndex = headerMatch.index;
  const detailsCloseIndex = content.indexOf('</details>', headerIndex);
  if (detailsCloseIndex === -1) return content;

  const beforeSection = content.slice(0, detailsCloseIndex);
  const afterSection = content.slice(detailsCloseIndex);

  // Находим последнюю строку таблицы перед закрывающим тегом
  // Табличные строки начинаются с |
  const trimmedBefore = beforeSection.trimEnd();
  const updatedContent = trimmedBefore + '\n' + newRow + '\n\n' + afterSection;
  return updatedContent;
}

async function main() {
  console.log('Fetching public repositories for', USERNAME);
  const repos = await getAllRepos();
  console.log(`Found ${repos.length} repositories`);

  const categorized = repos.map(classifyRepo).filter(Boolean);
  console.log(`Matched ${categorized.length} categorized projects`);

  const files = [
    {
      path: 'README.md',
      lang: 'ru',
      sectionHeaders: {
        MOD: /<summary><b>Minecraft моды[^<]*<\/summary>/i,
        PLUGIN: /<summary><b>Minecraft плагины[^<]*<\/summary>/i,
        CLI: /<summary><b>CLI утилиты[^<]*<\/summary>/i
      }
    },
    {
      path: 'README.en.md',
      lang: 'en',
      sectionHeaders: {
        MOD: /<summary><b>Minecraft Mods[^<]*<\/summary>/i,
        PLUGIN: /<summary><b>Minecraft Server Plugins[^<]*<\/summary>/i,
        CLI: /<summary><b>CLI Utilities[^<]*<\/summary>/i
      }
    }
  ];

  let anyModified = false;

  for (const fileInfo of files) {
    if (!fs.existsSync(fileInfo.path)) continue;

    let content = fs.readFileSync(fileInfo.path, 'utf8');
    let fileModified = false;

    for (const item of categorized) {
      // Проверяем, есть ли уже этот репозиторий в файле
      const escapedUrl = item.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const alreadyPresent = new RegExp(`\\[${item.cleanName}\\]\\(${escapedUrl}\\)`, 'i').test(content) ||
                             content.includes(item.url);

      if (!alreadyPresent) {
        const desc = fileInfo.lang === 'ru' ? item.descriptionRu : item.descriptionEn;
        const newRow = `| **[${item.cleanName}](${item.url})** | ${desc} |`;
        const sectionRegex = fileInfo.sectionHeaders[item.category];

        if (sectionRegex) {
          console.log(`[${fileInfo.path}] Adding new ${item.category}: ${item.cleanName}`);
          content = insertRowIntoSection(content, sectionRegex, newRow);
          fileModified = true;
          anyModified = true;
        }
      }
    }

    if (fileModified) {
      fs.writeFileSync(fileInfo.path, content, 'utf8');
      console.log(`Successfully updated ${fileInfo.path}`);
    } else {
      console.log(`No new items for ${fileInfo.path}`);
    }
  }

  if (anyModified) {
    console.log('Catalog update complete: files were modified.');
  } else {
    console.log('Catalog update complete: everything is up to date.');
  }
}

main().catch(err => {
  console.error('Fatal error updating catalog:', err);
  process.exit(1);
});
