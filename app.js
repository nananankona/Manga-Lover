const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';
const axiosInstance = axios.create({
  headers: {
    'User-Agent': UA
  }
});

async function main() {
  try {
    console.log("********MangaLover********");
    console.log("*The MangaLove Downloader*");
    console.log("*     Made By Kona       *");
    console.log("*    Education only      *");
    console.log("**************************");

    let url = process.argv[2];
    if (!url) {
      url = await askQuestion('Enter URL (例: https://mangalove.me/comic/4080): ');
    }

    if (!url.startsWith('https://mangalove.me/comic/')) {
      throw new Error('無効なURL形式です。mangalove.meの漫画URLを指定してください');
    }

    const { data } = await axiosInstance.get(url);
    const $ = cheerio.load(data);

    const genre = $('a[itemprop="genre"]').text().trim();
    const title = $('h1[itemprop="name"]').text().trim();
    const author = $('a[itemprop="author"]').text().trim();
    const publisher = $('a[itemprop="publisher"]').text().trim();

    console.log(`[-]:
  -  ジャンル: ${genre}
  -  タイトル: ${title}
  -  作者: ${author}
  -  出版社: ${publisher}`);

    const folderName = `./comics/[${genre}]-[${author}]-[${title}]-[${publisher}]/`;

    if (!fs.existsSync(folderName)) {
      fs.mkdirSync(folderName, { recursive: true });
      console.log(`[-] Created Folder: ${folderName}`);
    }

    const chapters = [];
    let page = 1;
    let hasMoreChapters = true;

    while (hasMoreChapters) {
      try {
        const paginatedUrl = `${url}?page=${page}`;
        const { data: pageData } = await axiosInstance.get(paginatedUrl);
        const page$ = cheerio.load(pageData);

        page$('ul.list-chapter li a').each((i, el) => {
          const chapterTitle = $(el).find('.title').text().trim();
          const chapterUrl = $(el).attr('href');
          chapters.push({ title: chapterTitle, url: chapterUrl });
        });

        page++;
      } catch (err) {
        if (err.response && err.response.status === 404) {
          hasMoreChapters = false;
          console.log(`[-] Finished fetching chapters at page ${page - 1}`);
        } else {
          throw err;
        }
      }
    }


    console.log(`[-] Found Chapters: ${chapters.length}`);

    for (const chapter of chapters) {
      console.log(`[+] Download: ${chapter.title}`);

      const chapterFolder = path.join(folderName, chapter.title);
      if (!fs.existsSync(chapterFolder)) {
        fs.mkdirSync(chapterFolder);
      }

      const { data: viewerData } = await axiosInstance.get(chapter.url);
      const viewer$ = cheerio.load(viewerData);

      const scriptContent = viewer$('script').filter((i, el) =>
        $(el).text().includes('var pagesCount')
      ).text();

      const pagesCount = extractVariable(scriptContent, 'pagesCount');
      const mangaID = extractVariable(scriptContent, 'mangaID');
      const seriesNumber = extractVariable(scriptContent, 'seriesNumber');
      const array = extractVariable(scriptContent, 'array');
      const keys = extractVariable(scriptContent, 'keys');
      const chapterID = extractVariable(scriptContent, 'chapterID');

      console.log(`[-] Page: ${pagesCount}, MangaID: ${mangaID}, SeriesNumber: ${seriesNumber}`);

      const imageArray = JSON.parse(array);
      const keyArray = JSON.parse(keys);

      for (let i = 0; i < imageArray.length; i++) {
        const imageInfo = imageArray[i];
        const keyInfo = keyArray.find(k => k.id === imageInfo.id);

        if (!keyInfo) {
          console.log(`[X] キーが見つかりません: ${imageInfo.id}`);
          continue;
        }

        const imageUrl = `https://j1z76bln.user.webaccel.jp/comics/${mangaID}/web/${seriesNumber}/${imageInfo.filename}`;
        console.log(`[+] Downloading: ${imageUrl}`);

        try {
          const { data: imageData } = await axiosInstance.get(imageUrl, { responseType: 'arraybuffer' });

          const canvas = createCanvas(keyInfo.key.width, keyInfo.key.height);
          const obfuscatedImage = await loadImage(imageData);
          const deobfuscatedCanvas = deobfuscate(obfuscatedImage, keyInfo.key, canvas);

          const outputPath = path.join(chapterFolder, `${i}.png`);
          const out = fs.createWriteStream(outputPath);
          const stream = deobfuscatedCanvas.createPNGStream();
          stream.pipe(out);

          await new Promise((resolve, reject) => {
            out.on('finish', resolve);
            out.on('error', reject);
          });

          console.log(`[+] Saved: ${outputPath}`);
        } catch (err) {
          console.error(`[X] 複合化鰓: ${err.message}`);
        }
      }
    }

    console.log('[+] Completed.');
  } catch (err) {
    console.error('[X] Error:', err);
  }
}

function deobfuscate(obfuscatedImage, json, tempCanvas) {
  const tempCtx = tempCanvas.getContext('2d');
  tempCanvas.width = json.width;
  tempCanvas.height = json.height;

  const verticalSlices = json.xSlices;
  const horizontalSlices = json.ySlices;
  const sliceWidth = json.sliceWidth;
  const sliceHeight = json.sliceHeight;
  const keys = json.slices;

  let count = 0;
  let xRemainderCount = 0;
  let yRemainderCount = 0;

  for (let i = 0; i < keys.length; i++) {
    const s = keys[i];
    const row = parseInt(s / verticalSlices);
    const col = s - row * verticalSlices;
    const x = (col * (sliceWidth));
    const y = (row * (sliceHeight));

    let width = sliceWidth;
    let height = sliceHeight;
    let canvasX, canvasY;

    if ((col == verticalSlices - 1) && (row == horizontalSlices - 1)) {
      width = json.width % sliceWidth;
      if (width == 0) { width = sliceWidth; }
      height = json.height % sliceHeight;
      if (height == 0) { height = sliceHeight; }

      canvasX = (verticalSlices - 1) * sliceWidth;
      canvasY = (horizontalSlices - 1) * sliceHeight;
    } else if (col == verticalSlices - 1) {
      width = json.width % sliceWidth;
      if (width == 0) { width = sliceWidth; }

      const canvasCol = verticalSlices - 1;
      canvasX = canvasCol * sliceWidth;
      canvasY = xRemainderCount * sliceHeight;
      xRemainderCount++;
    } else if (row == horizontalSlices - 1) {
      height = json.height % sliceHeight;
      if (height == 0) { height = sliceHeight; }

      const canvasRow = horizontalSlices - 1;
      canvasX = yRemainderCount * sliceWidth;
      canvasY = canvasRow * sliceHeight;
      yRemainderCount++;
    } else {
      const canvasRow = parseInt(count / (verticalSlices - 1));
      const canvasCol = count - canvasRow * (verticalSlices - 1);
      canvasX = (canvasCol * sliceWidth);
      canvasY = (canvasRow * sliceHeight);
      count++;
    }

    tempCtx.drawImage(
      obfuscatedImage,
      canvasX, canvasY, width, height,
      x, y, width, height
    );
  }

  return tempCanvas;
}

function extractVariable(scriptContent, varName) {
  const regex = new RegExp(`var ${varName} = '?(.*?)'?;`);
  const match = scriptContent.match(regex);
  return match ? match[1].replace(/^['"]|['"]$/g, '') : null;
}

function askQuestion(question) {
  return new Promise((resolve) => {
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });
    readline.question(question, (answer) => {
      readline.close();
      resolve(answer);
    });
  });
}


main();