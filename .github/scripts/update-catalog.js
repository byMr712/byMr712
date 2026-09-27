const fs = require('fs');
const https = require('https');

const USERNAME = 'byMr712';

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
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
  } catch (e) {
    // fallback
  }
  return text;
}

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
  } else if (/^MR-CLI-/i.test(name)) {
    category = 'CLI';
    cleanName = name;
  }

  if (!category) return null;

  // Берём описание напрямую из раздела About (поле description в GitHub API)
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

function insertRowIntoSection(content, sectionHeaderRegex, newRow) {
  const headerMatch = content.match(sectionHeaderRegex);
  if (!headerMatch) return content;

  const headerIndex = headerMatch.index;
  const detailsCloseIndex = content.indexOf('</details>', headerIndex);
  if (detailsCloseIndex === -1) return content;

  const beforeSection = content.slice(0, detailsCloseIndex);
  const afterSection = content.slice(detailsCloseIndex);

  const trimmedBefore = beforeSection.trimEnd();
  const updatedContent = trimmedBefore + '\n' + newRow + '\n\n' + afterSection;
  return updatedContent;
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

  const files = [
    {
      path: 'README.md',
      lang: 'ru',
      sectionHeaders: {
        MOD: /<summary>\s*<b>\s*Minecraft моды/i,
        PLUGIN: /<summary>\s*<b>\s*Minecraft плагины/i,
        CLI: /<summary>\s*<b>\s*CLI утилиты/i
      }
    },
    {
      path: 'README.en.md',
      lang: 'en',
      sectionHeaders: {
        MOD: /<summary>\s*<b>\s*Minecraft Mods/i,
        PLUGIN: /<summary>\s*<b>\s*Minecraft Server Plugins/i,
        CLI: /<summary>\s*<b>\s*CLI Utilities/i
      }
    }
  ];

  let anyModified = false;

  for (const fileInfo of files) {
    if (!fs.existsSync(fileInfo.path)) continue;

    let content = fs.readFileSync(fileInfo.path, 'utf8');
    let fileModified = false;

    for (const item of categorized) {
      const escapedUrl = item.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const alreadyPresent = new RegExp(`\\[${item.cleanName}\\]\\(${escapedUrl}\\)`, 'i').test(content) ||
                             content.includes(item.url);

      if (!alreadyPresent) {
        const desc = fileInfo.lang === 'ru' ? item.descriptionRu : item.descriptionEn;
        const newRow = `| **[${item.cleanName}](${item.url})** | ${desc} |`;
        const sectionRegex = fileInfo.sectionHeaders[item.category];

        if (sectionRegex) {
          console.log(`[${fileInfo.path}] Adding new ${item.category} (${fileInfo.lang}): ${item.cleanName} -> ${desc}`);
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

if (require.main === module) {
  updateCatalog().catch(err => {
    console.error('Fatal error updating catalog:', err);
    process.exit(1);
  });
}

module.exports = { updateCatalog, classifyAndDescribeRepo, insertRowIntoSection };
