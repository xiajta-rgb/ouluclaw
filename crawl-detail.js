const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const quickSleep = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
const mediumSleep = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms));
const longSleep = (ms = 1000) => new Promise(resolve => setTimeout(resolve, ms));

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

  try {
    const slider = await page.$('.slider-box, .verify-slider, .captcha-slider, [class*="slider"]').catch(() => null);
    const hasSliderText = await page.$('text=请拖动滑块').catch(() => null);
    const geetestCaptcha = await page.$('[class*="geetest_captcha"]').catch(() => null);

    await page.click('button.el-button--primary', {
      force: true
    });
    console.log('点击登录按钮');
    
    await sleep(2000);
    
    const sliderAfterClick = await page.$('.slider-box, .verify-slider, .captcha-slider, [class*="slider"]').catch(() => null);
    const hasSliderTextAfterClick = await page.$('text=请拖动滑块').catch(() => null);
    const geetestCaptchaAfterClick = await page.$('[class*="geetest_captcha"]').catch(() => null);
    
    if (sliderAfterClick || hasSliderTextAfterClick || geetestCaptchaAfterClick) {
      console.log('⚠️ 检测到验证码，等待手动完成...');
      console.log('请在弹出的浏览器窗口中完成验证码验证，完成后按回车继续...');
      
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
    const loginButton = await page.$('button.el-button--primary');
    if (loginButton) {
      await loginButton.click({ force: true });
      console.log('成功点击登录按钮');
    }
  }

  await mediumSleep();
  
  const sliderAfterLogin = await page.$('.slider-box, .verify-slider, .captcha-slider, [class*="slider"]').catch(() => null);
  const hasSliderTextAfterLogin = await page.$('text=请拖动滑块').catch(() => null);
  const geetestCaptchaAfterLogin = await page.$('[class*="geetest_captcha"]').catch(() => null);

  if (sliderAfterLogin || hasSliderTextAfterLogin || geetestCaptchaAfterLogin) {
    console.log('⚠️ 检测到验证码，等待手动完成...');
    console.log('请在弹出的浏览器窗口中完成验证码验证');
    await sleep(60000);
  }
  
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
  
  await sleep(3000);

  console.log('✅ 登录流程完成');
  return true;
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
    
    const [geetestCaptcha, sliderBox, hasSliderText, loginDialog, tableRows] = await Promise.all([
      page.$('[class*="geetest_captcha"]').catch(() => null),
      page.$('.slider-box, .verify-slider, .captcha-slider, [class*="slider"]').catch(() => null),
      page.$('text=请拖动滑块').catch(() => null),
      page.$('.el-overlay-dialog').catch(() => null),
      page.$$('tr.el-table__row').catch(() => [])
    ]);
    
    if (geetestCaptcha || sliderBox || hasSliderText) {
      console.log(`  [${checkCount}] 检测到验证码/滑块验证，等待完成...`);
      await sleep(1500);
      continue;
    }
    
    if (tableRows.length > 0) {
      console.log(`✅ 页面已就绪 (检查了 ${checkCount} 次, 找到 ${tableRows.length} 行数据)`);
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

async function crawlDetailUrls(urls) {
  const allDetailData = [];
  
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

    console.log('📍 打开鸥鹭网站首页检查登录...');
    await page.goto('https://vip.oalur.com/', { waitUntil: 'networkidle', timeout: 60000 });
    await quickSleep(2000);

    console.log('🔐 检测到第一个URL，需要登录...');
    await loginIfNeeded(page);
    
    console.log('🔄 登录完成，等待页面就绪...');
    const pageReady = await waitForPageReady(page, 'https://vip.oalur.com/');
    if (!pageReady) {
      console.log('⚠️ 页面已关闭，停止爬取');
      await browser.close();
      throw new Error('页面已关闭');
    }
    console.log('✅ 页面已就绪');

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 开始爬取明细数据，共 ${urls.length} 个URL...`);
    console.log('='.repeat(60));

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
        console.log('🌐 正在访问页面...');
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
        console.log('✅ 页面加载完成');
        
        const urlObj = new URL(url);
        const targetMonth = urlObj.searchParams.get('date') || '';
        
        console.log('🔍 等待排名数据加载...');
        const tableReady = await waitForPageReady(page, url);
        if (!tableReady) {
          console.log('⚠️ 页面加载失败，跳过');
          continue;
        }
        
        const detailRows = await page.$$('tr.el-table__row');
        console.log(`  找到 ${detailRows.length} 行数据`);
        
        if (detailRows.length < 5) {
          console.log('  ⚠️ 排名数据不足5名，跳过');
          continue;
        }
        
        const fifthRow = detailRows[4];
        console.log('  🖱️ 点击第5名...');
        await fifthRow.click();
        await longSleep(3000);
        
        console.log('  📋 等待明细数据加载...');
        await page.waitForSelector('.el-table', { timeout: 30000 });
        await longSleep(2000);
        
        const detailTableRows = await page.$$('.el-table__body tr.el-table__row');
        
        if (detailTableRows.length === 0) {
          console.log('  ⚠️ 未找到明细数据，跳过');
        } else {
          const row = detailTableRows[0];
          try {
            const cells = await row.$$('td');
            
            if (cells.length >= 8) {
              const rankText = await cells[0].innerText();
              const brandText = await cells[1].innerText();
              const salesText = await cells[2].innerText();
              const volumeText = await cells[3].innerText();
              const salesShareText = await cells[4].innerText();
              const volumeShareText = await cells[5].innerText();
              const ratingText = await cells[6].innerText();
              const reviewsText = await cells[7].innerText();
              
              let firstAvailable = '-';
              if (cells.length > 8) {
                firstAvailable = await cells[8].innerText();
              }
              
              allDetailData.push({
                date: targetMonth,
                rank: rankText.trim(),
                brand: brandText.trim(),
                sales: salesText.trim(),
                salesVolume: volumeText.trim(),
                salesShare: salesShareText.trim(),
                volumeShare: volumeShareText.trim(),
                rating: ratingText.trim(),
                reviews: reviewsText.trim(),
                firstAvailable: firstAvailable.trim(),
                sourceUrl: url
              });
              
              console.log(`    提取: ${rankText} - ${brandText}`);
            }
          } catch (e) {
            console.log('    提取行数据失败:', e.message);
          }
        }
        
        console.log(`  ✅ 完成，当前累计 ${allDetailData.length} 条数据`);
        
      } catch (urlError) {
        console.log(`  ❌ 爬取失败: ${urlError.message}`);
      }
    }

  } catch (error) {
    console.error('❌ 爬取失败:', error.message);
  } finally {
    await browser.close();
  }

  return allDetailData;
}

function convertToCSV(data) {
  if (data.length === 0) return '';
  
  const headers = ['日期', '排名', '品牌', '销售额', '销量', '销售额占比', '销量占比', '评分', '评论数', '上架时间', '来源URL'];
  const rows = data.map(item => [
    item.date || '',
    item.rank || '',
    item.brand || '',
    item.sales || '',
    item.salesVolume || '',
    item.salesShare || '',
    item.volumeShare || '',
    item.rating || '',
    item.reviews || '',
    item.firstAvailable || '',
    item.sourceUrl || ''
  ]);
  
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');
  
  return csvContent;
}

module.exports = { crawlDetailUrls, convertToCSV };
