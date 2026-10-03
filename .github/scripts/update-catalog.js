const fs = require('fs');
const https = require('https');

const USERNAME = 'byMr712';

function httpsGet(url, headers = {}) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'NodeJS-Catalog-Updater', ...headers } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

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
          resolve(JSON.parse(body));
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

async function translateText(text, fromLang, toLang) {
  if (!text) return text;
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${fromLang}|${toLang}`;
    const raw = await httpsGet(url);
    if (raw) {
      const json = JSON.parse(raw);
      if (json && json.responseData && json.responseData.translatedText) {
        return json.responseData.translatedText;
      }
    }
  } catch (e) {}
  return text;
}

const cliNames = [
  'AndroidMediaControlsWindows',
  'SteganoMIX',
  'FileBrowserQuantumForTOS',
  'DeskControl-Reloaded'
];

const webNames = [
  'MrModrinth',
  'MrOpenVPNClientWindows',
  'MrOpenVPNClient',
  'jino-business-card-local-editor',
  'WebSite-DDLC-Using-Flask'
];

const gameNames = [
  'AlKAsH3D-Engine',
  'Unity-WebGL-Game',
  'shoppe-keep-russian-translate',
  'P-Search'
];

async function classifyAndDescribeRepo(repo) {
  const name = repo.name;
  let category = null;
  let cleanName = name;

  if (/-MinecraftMod$/i.test(name)) {
    category = 'MOD';
    cleanName = name.replace(/-(\d+\.\d+(\.\d+)?-)?MinecraftMod$/i, '');
  } else if (/-MinecraftPlugin$/i.test(name)) {
    category = 'PLUGIN';
    cleanName = name.replace(/-MinecraftPlugin$/i, '');
  } else if (/^MR-CLI-/i.test(name) || cliNames.includes(name)) {
    category = 'CLI';
    cleanName = name;
  } else if (webNames.includes(name)) {
    category = 'WEB';
    cleanName = name;
  } else if (gameNames.includes(name)) {
    category = 'GAME';
    cleanName = name;
  }

  if (!category) return null;

  const aboutText = (repo.description || '').trim();
  let descRu = '';
  let descEn = '';

  if (aboutText) {
    const hasCyrillic = /[а-яА-ЯёЁ]/.test(aboutText);
    if (hasCyrillic) {
      descRu = aboutText;
      descEn = await translateText(aboutText, 'ru', 'en');
    } else {
      descEn = aboutText;
      descRu = await translateText(aboutText, 'en', 'ru');
    }
  } else {
    if (category === 'MOD') {
      descRu = `Модификация ${cleanName} для Minecraft`;
      descEn = `${cleanName} mod for Minecraft`;
    } else if (category === 'PLUGIN') {
      descRu = `Плагин ${cleanName} для Minecraft серверов`;
      descEn = `${cleanName} plugin for Minecraft servers`;
    } else if (category === 'WEB') {
      descRu = `Веб-проект ${cleanName}`;
      descEn = `Web project ${cleanName}`;
    } else if (category === 'GAME') {
      descRu = `Игровой проект ${cleanName}`;
      descEn = `Game project ${cleanName}`;
    } else {
      descRu = `Консольная утилита ${cleanName}`;
      descEn = `Command-line utility ${cleanName}`;
    }
  }

  return {
    category,
    cleanName,
    repoName: name,
    url: repo.html_url,
    descriptionRu: descRu,
    descriptionEn: descEn
  };
}

function replaceSectionTable(content, sectionRegex, tableHeaders, rows) {
  const match = content.match(sectionRegex);
  if (!match) return { content, modified: false };

  const summaryStartIndex = match.index;
  const summaryCloseIndex = content.indexOf('</summary>', summaryStartIndex);
  if (summaryCloseIndex === -1) return { content, modified: false };

  const detailsCloseIndex = content.indexOf('</details>', summaryCloseIndex);
  if (detailsCloseIndex === -1) return { content, modified: false };

  const beforeSummary = content.slice(0, summaryCloseIndex + '</summary>'.length);
  const afterDetails = content.slice(detailsCloseIndex);

  const newTableContent = '\n<br>\n\n' + tableHeaders.join('\n') + '\n' + rows.join('\n') + '\n\n';
  const newContent = beforeSummary + newTableContent + afterDetails;

  const oldSectionBody = content.slice(summaryCloseIndex + '</summary>'.length, detailsCloseIndex);
  const modified = oldSectionBody.trim() !== newTableContent.trim();

  return { content: newContent, modified };
}

function extractExistingRows(sectionBody) {
  const rows = [];
  const lines = sectionBody.split('\n');
  for (const line of lines) {
    const m = line.match(/^\|\s*\*\*\[(.*?)\]\((https:\/\/github\.com\/[^\)]+)\)\*\*\s*\|\s*(.*?)\s*\|/);
    if (m) {
      const urlParts = m[2].split('/');
      const repoName = urlParts[urlParts.length - 1];
      rows.push({
        cleanName: m[1].trim(),
        url: m[2].trim(),
        repoName: repoName,
        desc: m[3].trim()
      });
    }
  }
  return rows;
}

async function updateCatalog() {
  console.log('Fetching public repositories for', USERNAME);
  const repos = await getAllRepos();
  console.log(`Found ${repos.length} repositories`);

  const categorized = [];
  for (const repo of repos) {
    const item = await classifyAndDescribeRepo(repo);
    if (item) categorized.push(item);
  }
  console.log(`Matched ${categorized.length} categorized projects`);

  const categorizedByCat = { MOD: [], PLUGIN: [], CLI: [], WEB: [], GAME: [] };
  for (const item of categorized) {
    if (categorizedByCat[item.category]) {
      categorizedByCat[item.category].push(item);
    }
  }

  for (const cat of Object.keys(categorizedByCat)) {
    categorizedByCat[cat].sort((a, b) => a.cleanName.localeCompare(b.cleanName, 'en', { sensitivity: 'base', numeric: true }));
  }

  const configs = [
    {
      path: 'README.md',
      lang: 'ru',
      sections: {
        MOD: {
          regex: /<summary>\s*<b>\s*Minecraft моды/i,
          headers: ['| Мод | Описание |', '|---|---|'],
          getRow: item => `| **[${item.cleanName}](${item.url})** | ${item.descriptionRu} |`
        },
        PLUGIN: {
          regex: /<summary>\s*<b>\s*Minecraft плагины/i,
          headers: ['| Плагин | Описание |', '|---|---|'],
          getRow: item => `| **[${item.cleanName}](${item.url})** | ${item.descriptionRu} |`
        },
        CLI: {
          regex: /<summary>\s*<b>\s*CLI утилиты/i,
          headers: ['| Утилита / Программа | Описание |', '|---|---|'],
          getRow: item => `| **[${item.cleanName}](${item.url})** | ${item.descriptionRu} |`
        },
        WEB: {
          regex: /<summary>\s*<b>\s*Веб-сервисы и VPN/i,
          headers: ['| Проект | Описание |', '|---|---|'],
          getRow: item => `| **[${item.cleanName}](${item.url})** | ${item.descriptionRu} |`
        },
        GAME: {
          regex: /<summary>\s*<b>\s*Игры, движки, русификаторы/i,
          headers: ['| Проект | Описание |', '|---|---|'],
          getRow: item => `| **[${item.cleanName}](${item.url})** | ${item.descriptionRu} |`
        }
      }
    },
    {
      path: 'README.en.md',
      lang: 'en',
      sections: {
        MOD: {
          regex: /<summary>\s*<b>\s*Minecraft Mods/i,
          headers: ['| Mod | Description |', '|---|---|'],
          getRow: item => `| **[${item.cleanName}](${item.url})** | ${item.descriptionEn} |`
        },
        PLUGIN: {
          regex: /<summary>\s*<b>\s*Minecraft Server Plugins/i,
          headers: ['| Plugin | Description |', '|---|---|'],
          getRow: item => `| **[${item.cleanName}](${item.url})** | ${item.descriptionEn} |`
        },
        CLI: {
          regex: /<summary>\s*<b>\s*CLI Utilities/i,
          headers: ['| Utility / Tool | Description |', '|---|---|'],
          getRow: item => `| **[${item.cleanName}](${item.url})** | ${item.descriptionEn} |`
        },
        WEB: {
          regex: /<summary>\s*<b>\s*Web Services & VPN/i,
          headers: ['| Project | Description |', '|---|---|'],
          getRow: item => `| **[${item.cleanName}](${item.url})** | ${item.descriptionEn} |`
        },
        GAME: {
          regex: /<summary>\s*<b>\s*Games, Engines & Translations/i,
          headers: ['| Project | Description |', '|---|---|'],
          getRow: item => `| **[${item.cleanName}](${item.url})** | ${item.descriptionEn} |`
        }
      }
    }
  ];

  let anyModified = false;
  const added = new Set();
  const updated = new Set();
  const removed = new Set();

  for (const cfg of configs) {
    if (!fs.existsSync(cfg.path)) continue;

    let content = fs.readFileSync(cfg.path, 'utf8');
    let fileModified = false;

    for (const [cat, sec] of Object.entries(cfg.sections)) {
      const match = content.match(sec.regex);
      if (!match) continue;

      const summaryStartIndex = match.index;
      const summaryCloseIndex = content.indexOf('</summary>', summaryStartIndex);
      const detailsCloseIndex = content.indexOf('</details>', summaryCloseIndex);
      const oldBody = content.slice(summaryCloseIndex + '</summary>'.length, detailsCloseIndex);
      const oldRows = extractExistingRows(oldBody);

      const newItems = categorizedByCat[cat] || [];
      const newRows = newItems.map(sec.getRow);

      // Отслеживаем изменения
      for (const newItem of newItems) {
        const old = oldRows.find(o => o.url.toLowerCase() === newItem.url.toLowerCase() || o.repoName.toLowerCase() === newItem.repoName.toLowerCase());
        if (!old) {
          added.add(newItem.repoName);
        } else {
          const newDesc = cfg.lang === 'ru' ? newItem.descriptionRu : newItem.descriptionEn;
          if (old.desc !== newDesc || old.cleanName !== newItem.cleanName) {
            updated.add(newItem.repoName);
          }
        }
      }

      for (const old of oldRows) {
        const existsInNew = newItems.some(n => n.url.toLowerCase() === old.url.toLowerCase() || n.repoName.toLowerCase() === old.repoName.toLowerCase());
        if (!existsInNew) {
          removed.add(old.repoName || old.cleanName);
        }
      }

      const res = replaceSectionTable(content, sec.regex, sec.headers, newRows);
      if (res.modified) {
        content = res.content;
        fileModified = true;
        anyModified = true;
      }
    }

    if (fileModified) {
      fs.writeFileSync(cfg.path, content, 'utf8');
      console.log(`Successfully updated ${cfg.path}`);
    } else {
      console.log(`No table changes for ${cfg.path}`);
    }
  }

  const catalogChanges = {
    added: Array.from(added),
    updated: Array.from(updated).filter(x => !added.has(x)),
    removed: Array.from(removed)
  };

  const hasChanges = catalogChanges.added.length > 0 || catalogChanges.updated.length > 0 || catalogChanges.removed.length > 0;
  if (hasChanges) {
    fs.writeFileSync('.catalog_changes.json', JSON.stringify(catalogChanges), 'utf8');
    console.log('Catalog changes recorded:', catalogChanges);
  } else if (fs.existsSync('.catalog_changes.json')) {
    fs.unlinkSync('.catalog_changes.json');
  }

  if (anyModified) {
    console.log('Catalog sync complete: files were modified.');
  } else {
    console.log('Catalog sync complete: everything is up to date.');
  }
}

if (require.main === module) {
  updateCatalog().catch(err => {
    console.error('Fatal error updating catalog:', err);
    process.exit(1);
  });
}

module.exports = { updateCatalog, classifyAndDescribeRepo, replaceSectionTable };
