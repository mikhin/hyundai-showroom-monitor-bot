import puppeteer from 'puppeteer';
import TelegramBot from 'node-telegram-bot-api';
import winston from 'winston';
import cron from 'node-cron';

const hyundaiHost = 'https://showroom.hyundai.ru/';
const tgToken = 'SOME_TELEGRAM_TOKEN';
const tgChannelId = 'SOME_TELEGRAM_CHANNEL_ID';
const isProduction = process.env.NODE_ENV === 'production';

const bot = new TelegramBot(tgToken);
const logger = winston.createLogger({
  transports: [
    new winston.transports.File({
      filename: './log.txt',
    }),
  ],
});

start();

async function start() {
  exec();

  cron.schedule('* * * * *', () => {
    exec();
  });
}

async function exec() {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-setuid-sandbox',
      '--no-first-run',
      '--no-sandbox',
      '--no-zygote',
    ],
  });

  const page = await browser.newPage();

  await setBlockingOnRequests(page);

  try {
    await page.goto(hyundaiHost, { waitUntil: 'networkidle2' });
  } catch (error) {
    await createErrorReport(page, 'no-page', 'Ошибка посещения страницы', error);

    await page.close();
    await browser.close();
    return;
  }

  try {
    await page.waitForSelector('#cars-all .car-columns', { timeout: 1000 });
    const carsCount = (await page.$$('.car-item__wrap')).length;

    const timestamp = new Date().toTimeString();
    const message = `${pluralize(carsCount, 'Доступна', 'доступно', 'доступно')} ${carsCount} ${pluralize(carsCount, 'машина', 'машины', 'машин')} в ${timestamp}`;

    if (isProduction) {
      bot.sendMessage(tgChannelId, message);
    }

    logger.info(message);
  } catch (error) {
    await createErrorReport(page, 'no-cars', 'Ошибка поиска машин', error);
    await page.close();
    await browser.close();
  }
}

async function createErrorReport(page, type, message, techError) {
  const timestamp = new Date().toTimeString();

  logger.error(`${message} в ${timestamp}`, techError);

  const carListContainer = await page.$('#main-content');

  if (carListContainer) {
    await carListContainer.screenshot({
      path: `${type}-${timestamp}.jpeg`,
      type: 'jpeg',
      quality: 1,
    });
  } else {
    logger.error(`Не могу сделать скриншот отсутствия автомобилей в ${timestamp}`, techError);
  }
}

async function setBlockingOnRequests(page) {
  await page.setRequestInterception(true);

  page.on('request', (req) => {
    if (req.resourceType() === 'image'
      || req.resourceType() === 'media'
      || req.resourceType() === 'font'
      || req.resourceType() === 'stylesheet'
      || req.url()
        .includes('yandex')
      || req.url()
        .includes('nr-data')
      || req.url()
        .includes('rambler')
      || req.url()
        .includes('criteo')
      || req.url()
        .includes('adhigh')
      || req.url()
        .includes('dadata')
    ) {
      req.abort();
    } else {
      req.continue();
    }
  });
}

function pluralize(n, one, few, many) {
  const selectedRule = new Intl.PluralRules('ru-RU').select(n);

  switch (selectedRule) {
    case 'one': {
      return one;
    }
    case 'few': {
      return few;
    }
    default: {
      return many;
    }
  }
}
