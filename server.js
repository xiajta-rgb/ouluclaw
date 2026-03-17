const express = require('express');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 优化：减少不必要的等待时间
const quickSleep = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
const mediumSleep = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms));
const longSleep = (ms = 1000) => new Promise(resolve => setTimeout(resolve, ms));

// 不同国家的字段名称映射（使用更通用的模式）
const COUNTRY_FIELD_PATTERNS = {
  'US': /(?:预估大盘销售额|预估大盘销售额（美元）|Estimated Market Sales|预估大盘销量)[^\d]*([£$€¥]?[\d\.\-万%]+)/,
  'UK': /(?:预估大盘销售额|预估大盘销售额（英镑）|Estimated Market Sales|预估大盘销量)[^\d]*([£$€¥]?[\d\.\-万%]+)/,
  'DE': /(?:预估大盘销售额|预估大盘销售额（欧元）|Estimated Market Sales|预估大盘销量)[^\d]*([£$€¥]?[\d\.\-万%]+)/,
  'FR': /(?:预估大盘销售额|预估大盘销售额（欧元）|Estimated Market Sales|预估大盘销量)[^\d]*([£$€¥]?[\d\.\-万%]+)/,
  'ES': /(?:预估大盘销售额|预估大盘销售额（欧元）|Estimated Market Sales|预估大盘销量)[^\d]*([£$€¥]?[\d\.\-万%]+)/,
  'IT': /(?:预估大盘销售额|预估大盘销售额（欧元）|Estimated Market Sales|预估大盘销量)[^\d]*([£$€¥]?[\d\.\-万%]+)/,
  'JP': /(?:预估大盘销售额|预估大盘销售额（日元）|Estimated Market Sales|预估大盘销量)[^\d]*([£$€¥]?[\d\.\-万%]+)/,
  'CA': /(?:预估大盘销售额|Estimated Market Sales|预估大盘销量)[^\d]*([£$€¥]?[\d\.\-万%]+)/,
  'AU': /(?:预估大盘销售额|Estimated Market Sales|预估大盘销量)[^\d]*([£$€¥]?[\d\.\-万%]+)/
};

const DEFAULT_FIELD_PATTERN = /(?:预估大盘销售额|预估大盘销售额（[^）]+）|Estimated Market Sales|预估大盘销量)[^\d]*([£$€¥]?[\d\.\-万%]+)/;

function resolveCountry(urls, country) {
  if (country && country !== 'auto') {
    console.log(`✅ 使用指定国家: ${country}`);
    return country.toUpperCase();
  }
  
  // 从URL中自动提取国家
  for (const url of urls) {
    const match = url.match(/[?&]site=([A-Z]{2})/i);
    if (match) {
      const detectedCountry = match[1].toUpperCase();
      console.log(`✅ 从URL自动识别国家: ${detectedCountry}`);
      return detectedCountry;
    }
  }
  
  console.log('⚠️ 无法识别国家，使用默认 US');
  return 'US';
}

function getFieldPattern(country) {
  return COUNTRY_FIELD_PATTERNS[country] || DEFAULT_FIELD_PATTERN;
}

function buildDetailUrl(chartUrl, targetMonth, startDate, endDate) {
  try {
    const urlObj = new URL(chartUrl);
    const pathId = urlObj.searchParams.get('pathId') || '';
    const pathName = urlObj.searchParams.get('pathName') || '';
    const site = urlObj.searchParams.get('site') || '';
    
    const [year, month] = targetMonth.split('-');
    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
    
    const date = `${targetMonth}-01`;
    const endDateVal = `${year}-${month}-${lastDay.toString().padStart(2, '0')}`;
    
    const start = startDate || '2023-01-01';
    const end = endDate || '2025-12-01';
    
    const detailUrl = `https://vip.oalur.com/analysis/market/list?date=${date}&endDate=${endDateVal}&salesSeller=1&start=${start}&end=${end}&pathId=${pathId}&pathName=${encodeURIComponent(pathName)}&site=${site}`;
    
    return detailUrl;
  } catch (e) {
    console.error('构建明细页URL失败:', e.message);
    return '';
  }
}

function findMaxSalesItem(rawData, startDate, endDate) {
  let maxItem = null;
  let maxValue = -Infinity;
  
  for (const item of rawData) {
    const salesNum = parseFloat(item.sales.replace('万', '').replace(/[£$€¥]/g, ''));
    if (!isNaN(salesNum) && salesNum > maxValue) {
      maxValue = salesNum;
      maxItem = item;
    }
  }
  
  if (!maxItem) {
    maxItem = rawData[0] || { date: '', sales: '' };
  }
  
  return {
    month: maxItem.date,
    sales: maxItem.sales,
    detailUrl: buildDetailUrl(globalChartUrl || '', maxItem.date, startDate, endDate)
  };
}

let globalChartUrl = '';

async function loginIfNeeded(page) {
  console.log('🔍 检查是否需要登录...');

  const loginDialog = await page.$('.el-overlay-dialog');
  if (!loginDialog) {
    console.log('✅ 无需登录或已登录');
    return true;
  }

  console.log('检测到登录弹窗');

  const aiReportClose = await page.$('text=我知道了');
  if (aiReportClose) {
    console.log('关闭AI市场报告弹窗...');
    await aiReportClose.click();
    await quickSleep();
  }

  const scanPos = await page.$('.SCAN.pos');
  if (scanPos) {
    console.log('点击切换登录模式...');
    await scanPos.click();
    await mediumSleep();
  }

  const passwordLoginTab = await page.$('text=密码登录');
  if (passwordLoginTab) {
    console.log('点击密码登录选项卡...');
    await passwordLoginTab.click();
    await mediumSleep();
  }

  console.log('填写登录信息...');
  await page.fill('input[name="account"]', '18060944545');
  await page.fill('input[name="password"]', 'HU69rde4');
  await quickSleep();

  // 点击登录按钮
  try {
    // 先检查是否有验证码，如果有，直接等待用户操作
    const slider = await page.$('.slider-box, .verify-slider, .captcha-slider, [class*="slider"]').catch(() => null);
    const hasSliderText = await page.$('text=请拖动滑块').catch(() => null);
    const geetestCaptcha = await page.$('[class*="geetest_captcha"]').catch(() => null);

    // 点击登录按钮
    await page.click('button.el-button--primary', {
      force: true
    });
    console.log('点击登录按钮');
    
    // 等待一下看是否出现验证码
    await sleep(2000);
    
    // 检查是否有验证码出现
    const sliderAfterClick = await page.$('.slider-box, .verify-slider, .captcha-slider, [class*="slider"]').catch(() => null);
    const hasSliderTextAfterClick = await page.$('text=请拖动滑块').catch(() => null);
    const geetestCaptchaAfterClick = await page.$('[class*="geetest_captcha"]').catch(() => null);
    
    if (sliderAfterClick || hasSliderTextAfterClick || geetestCaptchaAfterClick) {
      console.log('⚠️ 检测到验证码，等待手动完成...');
      console.log('请在弹出的浏览器窗口中完成验证码验证，完成后按回车继续...');
      
      // 等待用户完成验证码 - 最多等待5分钟
      let captchaWaitCount = 0;
      while (captchaWaitCount < 300) {
        const stillHasSlider = await page.$('.slider-box, .verify-slider, .captcha-slider, [class*="slider"]').catch(() => null);
        const stillHasSliderText = await page.$('text=请拖动滑块').catch(() => null);
        const stillHasCaptcha = await page.$('[class*="geetest_captcha"]').catch(() => null);
        
        if (!stillHasSlider && !stillHasSliderText && !stillHasCaptcha) {
          console.log('✅ 验证码验证完成');
          break;
        }
        
        if (captchaWaitCount % 10 === 0) {
          console.log(`  等待验证码完成... (${captchaWaitCount}s)`);
        }
        
        await sleep(1000);
        captchaWaitCount++;
      }
    }
  } catch (error) {
    console.log('点击登录按钮失败，尝试直接点击按钮元素');
    // 尝试直接点击按钮元素
    const loginButton = await page.$('button.el-button--primary');
    if (loginButton) {
      await loginButton.click({ force: true });
      console.log('成功点击登录按钮');
    }
  }

  await mediumSleep();
  
  // 再次检查是否有验证码（可能登录后才出现）
  const sliderAfterLogin = await page.$('.slider-box, .verify-slider, .captcha-slider, [class*="slider"]').catch(() => null);
  const hasSliderTextAfterLogin = await page.$('text=请拖动滑块').catch(() => null);
  const geetestCaptchaAfterLogin = await page.$('[class*="geetest_captcha"]').catch(() => null);

  if (sliderAfterLogin || hasSliderTextAfterLogin || geetestCaptchaAfterLogin) {
    console.log('⚠️ 检测到验证码，等待手动完成...');
    console.log('请在弹出的浏览器窗口中完成验证码验证');
    await sleep(60000);
  }
  
  // 等待登录弹窗完全消失
  console.log('⏳ 等待登录弹窗消失...');
  let waitCount = 0;
  while (waitCount < 30) {
    const loginDialog = await page.$('.el-overlay-dialog');
    const slider = await page.$('.slider-box, .verify-slider, .captcha-slider, [class*="slider"]').catch(() => null);
    const hasSliderText = await page.$('text=请拖动滑块').catch(() => null);
    const geetestCaptcha = await page.$('[class*="geetest_captcha"]').catch(() => null);
    
    if (!loginDialog && !slider && !hasSliderText && !geetestCaptcha) {
      console.log('✅ 登录弹窗已消失');
      break;
    }
    
    if (loginDialog) console.log('  等待登录弹窗消失...');
    if (slider || hasSliderText) console.log('  等待滑块验证完成...');
    if (geetestCaptcha) console.log('  等待验证码完成...');
    
    await sleep(1000);
    waitCount++;
  }
  
  // 额外等待确保页面稳定
  await sleep(3000);

  console.log('✅ 登录流程完成');
  return true;
}

async function setDateRange(page, startDate, endDate) {
  const start = startDate || '2023-01';
  const end = endDate || '2025-12';
  console.log(`📅 设置日期范围为 ${start} 到 ${end}...`);

  try {
    // 使用 page.evaluate 直接操作 DOM，参考提供的脚本
    await page.evaluate(({ start, end }) => {
      return new Promise((resolve, reject) => {
        // 工具函数：等待元素加载
        function waitForElement(selector, timeout = 10000) {
          return new Promise((res, rej) => {
            const checkInterval = setInterval(() => {
              const el = document.querySelector(selector);
              if (el) {
                clearInterval(checkInterval);
                res(el);
              }
            }, 100);
            setTimeout(() => {
              clearInterval(checkInterval);
              rej(new Error(`超时未找到元素：${selector}`));
            }, timeout);
          });
        }

        // 工具函数：休眠
        function sleep(ms) {
          return new Promise(r => setTimeout(r, ms));
        }

        async function doSetDate() {
          try {
            // 步骤1：定位日期选择器容器
            const datePicker = await waitForElement('.el-date-editor--monthrange');
            if (!datePicker) {
              throw new Error('未找到日期选择器');
            }

            // 步骤2：点击展开日期面板
            datePicker.click();
            await sleep(300);

            // 步骤3：定位开始/结束日期输入框
            const dateInputs = datePicker.querySelectorAll('.el-range-input');
            if (dateInputs.length < 2) {
              throw new Error('日期输入框数量异常');
            }
            const startInput = dateInputs[0];
            const endInput = dateInputs[1];

            // 步骤4：修改开始日期
            startInput.focus();
            startInput.value = start;
            startInput.dispatchEvent(new Event('input', { bubbles: true }));
            startInput.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(150);

            // 步骤5：修改结束日期
            endInput.focus();
            endInput.value = end;
            endInput.dispatchEvent(new Event('input', { bubbles: true }));
            endInput.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(150);

            // 步骤6：关闭日期面板
            document.body.click();
            await sleep(200);

            resolve({ success: true, start: startInput.value, end: endInput.value });
          } catch (err) {
            reject(err);
          }
        }

        doSetDate();
      });
    }, { start, end });

    console.log('✅ 日期范围设置完成');
  } catch (error) {
    console.log('⚠️ 设置日期范围失败:', error.message);
  }
}

async function extractSalesData(page, startDate, endDate, country = 'US') {
  console.log('📊 开始提取销售额数据...');
  console.log(`📅 日期范围: ${startDate} 至 ${endDate}`);
  console.log(`🌍 国家: ${country}`);
  
  const fieldPattern = getFieldPattern(country);
  console.log(`🔍 使用字段匹配模式: ${fieldPattern}`);

  // 先设置日期范围
  await setDateRange(page, startDate, endDate);
  console.log('✅ 日期范围设置完成');

  const selectBox = await page.waitForSelector('.el-select.mr-15.w-130.market-select', { timeout: 10000 });
  console.log('✅ 找到下拉框');
  await selectBox.click();
  await quickSleep();

  // 直接使用 evaluate 获取选项，避免元素句柄失效
  const options = await page.evaluate(() => {
    const items = document.querySelectorAll('.el-select-dropdown__item');
    return Array.from(items).map(item => item.textContent.trim());
  });
  console.log('📋 可用选项:', options);

  // 检查是否有"销售额"或"销量"选项（不同站点可能不同）
  const hasSalesOption = options.some(opt => opt.includes('销售额'));
  const hasVolumeOption = options.some(opt => opt.includes('销量'));
  
  if (!hasSalesOption && !hasVolumeOption) {
    console.error('❌ 下拉列表中没有"销售额"或"销量"选项！');
    throw new Error('下拉列表中没有"销售额"或"销量"选项');
  }
  
  // 优先选择"销售额"，如果没有则选择"销量"
  const targetOption = hasSalesOption ? '销售额' : '销量';
  console.log(`📋 目标选项: ${targetOption}`);
  
  // 通过 evaluate 点击找到的选项
  await page.evaluate((target) => {
    const allItems = Array.from(document.querySelectorAll('.el-select-dropdown__item'));
    const targetItem = allItems.find(item => item.textContent.includes(target));
    if (targetItem) targetItem.click();
  }, targetOption);
  
  console.log(`✅ 已选择"${targetOption}"选项`);
  await mediumSleep();

  const canvas = await page.waitForSelector('#estimate-sales-chart canvas', { timeout: 10000 });
  const rect = await canvas.boundingBox();
  console.log('✅ 找到Canvas, 位置:', rect);

  const startX = rect.x + 50;
  const endX = rect.x + rect.width - 50;
  const stepX = 80;
  const hoverY = rect.y + rect.height / 2;

  const rawData = [];
  const dateSet = new Set();

  console.log(`🖱️ 开始遍历Canvas提取数据... (X范围: ${startX} - ${endX}, 步长: ${stepX})`);

  for (let x = startX; x <= endX; x += stepX) {
    await page.evaluate(({ cx, cy }) => {
      const canvas = document.querySelector('#estimate-sales-chart canvas');
      if (canvas) {
        canvas.dispatchEvent(new MouseEvent('mousemove', {
          clientX: cx,
          clientY: cy,
          bubbles: true,
          view: window
        }));
      }
    }, { cx: x, cy: hoverY });

    await quickSleep(150);

    const tooltipData = await page.evaluate((patternStr) => {
      const pattern = new RegExp(patternStr);
      const tooltip = document.querySelector('#estimate-sales-chart .g2-tooltip');
      if (!tooltip) return { error: 'no tooltip' };

      const style = window.getComputedStyle(tooltip);
      const visibility = style.visibility;
      const innerText = tooltip.innerText || '';

      const date = tooltip.querySelector('.g2-tooltip-title')?.textContent?.trim() || '';
      const tooltipText = tooltip.innerText || '';
      const salesMatch = tooltipText.match(pattern);
      const sales = salesMatch ? salesMatch[1].trim() : '';

      return { date, sales, fullText: tooltipText, visibility, error: null };
    }, fieldPattern.source);

    if (tooltipData && tooltipData.date && tooltipData.sales) {
      const month = tooltipData.date.substring(0, 7);
      if (!dateSet.has(month)) {
        dateSet.add(month);
        rawData.push({ date: tooltipData.date, sales: tooltipData.sales });
        console.log(`  📊 ${tooltipData.date} → ${tooltipData.sales}`);
      }
    }
  }

  console.log(`\n📈 原始数据提取完成，共 ${rawData.length} 条:`);
  console.log(rawData);

  if (rawData.length === 0) {
    console.error('❌ 未提取到任何数据！');
    throw new Error('未提取到任何数据，请检查页面是否正常加载');
  }

  console.log('\n📈 每月数据:');
  console.log(rawData);

  const maxSalesItem = findMaxSalesItem(rawData, startDate, endDate);
  console.log(`🏆 最高销售额月份: ${maxSalesItem.month} - ${maxSalesItem.sales}`);
  console.log(`🔗 明细页链接: ${maxSalesItem.detailUrl}`);

  return rawData.map(item => ({
    date: item.date,
    sales: item.sales,
    detailUrl: item.date === maxSalesItem.month ? maxSalesItem.detailUrl : ''
  }));
}

async function waitForPageReady(page, url) {
  console.log('⏳ 等待页面加载完成...');
  
  const maxWaitTime = 30000;
  const startTime = Date.now();
  let checkCount = 0;
  
  while (Date.now() - startTime < maxWaitTime) {
    if (!page || page.isClosed()) {
      console.log('⚠️ 页面已关闭');
      return false;
    }
    
    checkCount++;
    
    const [geetestCaptcha, sliderBox, hasSliderText, loginDialog, datePicker, chart, canvas] = await Promise.all([
      page.$('[class*="geetest_captcha"]').catch(() => null),
      page.$('.slider-box, .verify-slider, .captcha-slider, [class*="slider"]').catch(() => null),
      page.$('text=请拖动滑块').catch(() => null),
      page.$('.el-overlay-dialog').catch(() => null),
      page.$('.el-date-editor--monthrange').catch(() => null),
      page.$('#estimate-sales-chart').catch(() => null),
      page.$('#estimate-sales-chart canvas').catch(() => null)
    ]);
    
    if (geetestCaptcha || sliderBox || hasSliderText) {
      console.log(`  [${checkCount}] 检测到验证码/滑块验证，等待完成...`);
      await sleep(1500);
      continue;
    }
    
    if (datePicker && chart && canvas) {
      console.log(`✅ 页面已就绪 (检查了 ${checkCount} 次)`);
      await sleep(1500);
      return true;
    }
    
    if (loginDialog && checkCount % 5 === 0) {
      console.log(`  [${checkCount}] 等待登录弹窗关闭...`);
    }
    
    await sleep(500);
  }
  
  console.log('⚠️ 等待超时，尝试继续执行...');
  return true;
}

async function crawlUrls(urls, startDate, endDate, country = 'auto') {
  const results = [];
  const finalCountry = resolveCountry(urls, country);

  console.log('🔧 正在启动浏览器...');
  
  let browser;
  try {
    browser = await chromium.launch({
      headless: false,
      channel: 'msedge',
      devtools: true,
      timeout: 30000
    });
    console.log('✅ 浏览器启动成功');
  } catch (err) {
    console.error('❌ 浏览器启动失败:', err.message);
    throw new Error(`浏览器启动失败: ${err.message}`);
  }

  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });
    const page = await context.newPage();

    let isCrawlStopped = false;

    page.on('close', () => {
      console.log('⚠️ 浏览器已被关闭，停止爬取...');
      isCrawlStopped = true;
    });

    let isFirstUrl = true;
    let firstUrlProcessed = false;

    for (let i = 0; i < urls.length; i++) {
      if (isCrawlStopped) {
        console.log('🛑 爬取已停止');
        break;
      }
      const url = urls[i];
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📄 正在处理第 ${i + 1}/${urls.length} 个URL`);
      console.log('URL:', url);
      console.log('='.repeat(60));

      try {
        if (isCrawlStopped) {
          console.log('🛑 爬取已停止');
          break;
        }
        console.log('🌐 正在访问页面...');
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
        console.log('✅ 页面加载完成');
        await mediumSleep();

        if (isFirstUrl) {
          console.log('🔐 检测到第一个URL，需要登录...');
          await loginIfNeeded(page);
          isFirstUrl = false;
          
          // 登录完成后，等待页面完全就绪
          console.log('🔄 登录完成，等待页面就绪...');
          const pageReady = await waitForPageReady(page, url);
          if (!pageReady) {
            console.log('⚠️ 页面已关闭，停止爬取');
            isCrawlStopped = true;
            break;
          }
          console.log('✅ 页面已就绪');
          
          // 第一个URL处理两次，第一次结果不保存
          if (!firstUrlProcessed) {
            console.log('🔄 第一个URL预处理方式：先处理一次（结果不保存）...');
            try {
              await extractSalesData(page, startDate, endDate, finalCountry);
              console.log('✅ 第一次预处理完成');
            } catch (e) {
              console.log('⚠️ 第一次预处理失败，继续正式处理...');
            }
            firstUrlProcessed = true;
            
            // 重新访问页面进行正式处理
            console.log('🌐 重新访问页面进行正式处理...');
            await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
            await mediumSleep();
          }
        } else {
          console.log('✅ 已登录，直接提取数据');
        }

        console.log('📊 开始提取数据...');
        globalChartUrl = url;
        const data = await extractSalesData(page, startDate, endDate, finalCountry);
        console.log('✅ 数据提取成功');
        results.push({ url, success: true, data });
      } catch (error) {
        console.error('❌ 提取数据失败:', error.message);
        console.error('❌ 错误堆栈:', error.stack);
        results.push({ url, success: false, error: error.message });
      }
    }

  } catch (error) {
    console.error('❌ 爬取失败:', error.message);
  } finally {
    await browser.close();
  }

  return results;
}

app.post('/api/crawl', async (req, res) => {
  const { urls, startDate, endDate, country } = req.body;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: '请提供有效的URL列表' });
  }

  console.log('收到爬取任务:', urls);
  console.log('日期范围:', startDate || '2023-01', '至', endDate || '2025-12');
  console.log('国家:', country || 'auto (自动识别)');

  const startTime = Date.now();

  try {
    const results = await crawlUrls(urls, startDate, endDate, country);
    
    const duration = Date.now() - startTime;

    console.log('\n📊 爬取结果统计:');
    console.log(`总URL数: ${urls.length}`);
    console.log(`结果数: ${results.length}`);
    results.forEach((r, i) => {
      console.log(`  [${i+1}] ${r.url} - ${r.success ? '成功' : '失败'}`);
      if (r.success) {
        console.log(`      数据:`, r.data);
      } else {
        console.log(`      错误:`, r.error);
      }
    });

    const crawlTime = new Date().toISOString();
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    console.log(`\n✅ 成功: ${successCount}, ❌ 失败: ${failCount}`);

    const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
    const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

    let csvContent = '类目,' + monthNames.join(',') + ',明细页链接\n';

    results.forEach(result => {
      if (result.success) {
        const urlMatch = result.url.match(/pathName=([^&]+)/);
        let category = 'Unknown';
        if (urlMatch) {
          category = decodeURIComponent(urlMatch[1].replace(/\(Current\)/g, ''));
          category = category.replace(/[+]/g, ' ').trim();
        }
        console.log(`📁 提取的类目: ${category}`);
        console.log(`📊 result.data:`, JSON.stringify(result.data));

        const monthData = {};
        let detailUrl = '';
        
        result.data.forEach((item) => {
          const month = item.date.substring(5, 7);
          const salesNum = parseFloat(item.sales.replace('万', '').replace(/[£$€¥]/g, ''));
          monthData[month] = isNaN(salesNum) ? item.sales : salesNum.toFixed(1);
          if (item.detailUrl) {
            detailUrl = item.detailUrl;
          }
        });

        let row = category;
        for (const m of months) {
          row += ',' + (monthData[m] || '');
        }
        row += ',' + detailUrl;
        csvContent += row + '\n';
        
        console.log(`  CSV行: ${row}`);
      }
    });

    console.log(`📝 csvContent:`, csvContent);

    const timestamp = Date.now();
    const filename = `crawl-${timestamp}.csv`;
    const outputPath = path.join(DATA_DIR, filename);
    fs.writeFileSync(outputPath, '\uFEFF' + csvContent, 'utf-8');

    res.json({ success: true, results, filename, duration });
  } catch (error) {
    console.error('爬取错误:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/history', (req, res) => {
  try {
    const files = fs.readdirSync(DATA_DIR)
      .filter(file => file.endsWith('.csv'))
      .map(file => {
        const filePath = path.join(DATA_DIR, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        
        // 解析新格式CSV（统计不同类目数量）
        const categories = new Set();
        
        // 跳过标题行，统计不同类目
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line) {
            const parts = line.split(',');
            if (parts.length > 0) {
              const category = parts[0].trim();
              if (category && category !== '类目') {
                categories.add(category);
              }
            }
          }
        }

        const totalUrls = categories.size;
        const successCount = categories.size;
        const failCount = 0;

        // 获取爬取时间（从文件名解析）
        const timeMatch = file.match(/crawl-(\d+)/);
        const timestamp = timeMatch ? parseInt(timeMatch[1]) : Date.now();

        return {
          filename: file,
          time: timestamp,
          totalUrls,
          successCount,
          failCount
        };
      })
      .sort((a, b) => new Date(b.time) - new Date(a.time));

    res.json({ success: true, files });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(DATA_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '文件不存在' });
  }

  res.download(filePath);
});

app.delete('/api/history/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(DATA_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '文件不存在' });
  }

  try {
    // 删除CSV文件
    fs.unlinkSync(filePath);
    
    // 同时删除对应的JSON文件
    const jsonFilename = filename.replace('.csv', '.json');
    const jsonPath = path.join(DATA_DIR, jsonFilename);
    if (fs.existsSync(jsonPath)) {
      fs.unlinkSync(jsonPath);
    }
    
    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/history/all', (req, res) => {
  try {
    const files = fs.readdirSync(DATA_DIR)
      .filter(file => file.endsWith('.csv') || file.endsWith('.json'));

    files.forEach(file => {
      const filePath = path.join(DATA_DIR, file);
      fs.unlinkSync(filePath);
    });

    const csvCount = files.filter(f => f.endsWith('.csv')).length;
    res.json({ success: true, message: `已删除 ${csvCount} 个爬取记录` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const { crawlDetailUrls, convertToCSV } = require('./crawl-detail');

app.post('/api/crawl-detail', async (req, res) => {
  const startTime = Date.now();
  const { urls } = req.body;
  
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: '请提供有效的URL列表' });
  }
  
  try {
    console.log(`🚀 开始爬取明细数据，共 ${urls.length} 个URL...`);
    
    const allDetailData = await crawlDetailUrls(urls);
    
    const duration = Date.now() - startTime;
    
    if (allDetailData.length > 0) {
      const filename = `detail-${Date.now()}.csv`;
      const outputPath = path.join(DATA_DIR, filename);
      const csvContent = convertToCSV(allDetailData);
      fs.writeFileSync(outputPath, '\uFEFF' + csvContent, 'utf-8');
      
      console.log(`\n✅ 明细爬取完成: ${allDetailData.length} 条数据，耗时 ${duration}ms`);
      return res.json({ 
        success: true, 
        message: `成功爬取 ${allDetailData.length} 条明细数据`,
        data: allDetailData,
        filename,
        duration
      });
    } else {
      return res.json({ success: false, error: '未获取到明细数据' });
    }
    
  } catch (error) {
    console.error('❌ 明细爬取错误:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`爬虫服务已启动: http://localhost:${PORT}`);
});
