/**
 * 鸥鹭销售额爬虫 - 最终版
 * 功能：选择销售额下拉框 → 提取预估大盘销售额 → 按年求和 → 传统方式复制到剪贴板
 * 特点：极速爬取、无语法错误、无需页面聚焦、仅提取销售额、按年求和
 */
async function crawlOuluSalesData() {
  try {
    // ====================== 步骤1：选择下拉框的“销售额”选项 ======================
    // 等待并点击销售额下拉容器
    const selectBox = await waitForElement('.el-select.mr-15.w-130.market-select');
    selectBox.click();
    await sleep(500); // 缩短等待，提升速度

    // 等待下拉列表并选择“销售额”选项
    const optionList = await waitForElement('.el-select-dropdown__list');
    const salesOption = Array.from(optionList.querySelectorAll('.el-select-dropdown__item'))
      .find(item => item.textContent.includes('销售额'));
    
    if (!salesOption) {
      alert('❌ 未找到“销售额”下拉选项，请检查页面文本');
      return;
    }
    salesOption.click();
    await sleep(2000); // 等待图表数据加载

    // ====================== 步骤2：遍历Canvas提取销售额数据 ======================
    const canvas = await waitForElement('#estimate-sales-chart canvas');
    const rect = canvas.getBoundingClientRect();
    const startX = rect.left + 50;   // 起始X（避开图表边缘）
    const endX = rect.right - 50;    // 结束X
    const stepX = 40;                // 大步长，提升爬取速度
    const hoverY = rect.top + rect.height / 2; // 固定Y轴（图表中间）

    const rawData = [];  // 原始数据（日期+销售额）
    const dateSet = new Set(); // 去重，避免重复提取同一日期

    // 从左到右遍历Canvas，模拟鼠标悬浮提取数据
    for (let x = startX; x <= endX; x += stepX) {
      // 简化鼠标模拟，仅触发核心的mousemove事件
      canvas.dispatchEvent(new MouseEvent('mousemove', {
        clientX: x,
        clientY: hoverY,
        bubbles: true,
        view: window
      }));
      await sleep(300); // 最短等待，确保Tooltip加载

      // 提取Tooltip中的日期和预估大盘销售额（仅保留销售额，移除同比）
      const tooltip = document.querySelector('#estimate-sales-chart .g2-tooltip');
      if (!tooltip) continue;

      // 提取日期
      const date = tooltip.querySelector('.g2-tooltip-title')?.textContent?.trim() || '';
      // 提取预估大盘销售额（正则匹配，不依赖元素位置）
      const tooltipText = tooltip.innerText || '';
      const salesMatch = tooltipText.match(/预估大盘销售额（美元）\s*([\d\.\-万%]+)/);
      const sales = salesMatch ? salesMatch[1].trim() : '';

      // 去重并保存有效数据
      if (date && sales && !dateSet.has(date)) {
        dateSet.add(date);
        rawData.push({ date, sales });
        console.log(`📊 提取到：${date} → ${sales}`);
      }
    }

    // ====================== 步骤3：按年份求和 ======================
    const yearSum = {}; // 按年求和结果
    rawData.forEach(item => {
      // 拆分年份（2024-01 → 2024）
      const year = item.date.split('-')[0];
      // 转换销售额为数字（860.93万 → 860.93）
      const salesNum = parseFloat(item.sales.replace('万', ''));
      
      // 过滤无效数字，避免求和错误
      if (isNaN(salesNum)) return;
      // 按年累加，保留1位小数精度
      yearSum[year] = (yearSum[year] || 0) + salesNum;
    });

    // ====================== 步骤4：传统方式复制到剪贴板（无聚焦限制） ======================
    // 格式化求和结果（易读格式）
    let resultText = '';
    for (const year in yearSum) {
      const totalSales = yearSum[year].toFixed(1); // 保留1位小数
      resultText += `${year}年预估大盘销售额（美元）：${totalSales}万\n`;
    }

    // 无有效数据时提示
    if (!resultText) {
      alert('⚠️ 未提取到有效销售额数据，请检查页面或重试');
      return;
    }

    // 传统复制逻辑（创建隐藏textarea，避免页面聚焦限制）
    const textarea = document.createElement('textarea');
    textarea.value = resultText;
    // 隐藏textarea，避免页面闪烁
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);

    // 选中并复制到剪贴板
    textarea.select();
    document.execCommand('copy');

    // 清理临时元素
    document.body.removeChild(textarea);

    // 提示复制成功
    console.log('\n🎉 按年求和数据已复制到剪贴板：\n' + resultText);
    alert(`✅ 复制成功！\n\n${resultText}`);

  } catch (error) {
    // 错误提示，方便排查
    console.error('❌ 脚本执行失败：', error.message);
    alert(`脚本执行失败：${error.message}`);
  }
}

// ====================== 工具函数（极简无冗余） ======================
/**
 * 等待元素加载
 * @param {string} selector - 元素选择器
 * @param {number} timeout - 超时时间（默认10秒）
 * @returns {Promise<HTMLElement>} 加载完成的元素
 */
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const checkInterval = setInterval(() => {
      const element = document.querySelector(selector);
      if (element) {
        clearInterval(checkInterval);
        resolve(element);
      }
    }, 100);

    // 超时处理
    setTimeout(() => {
      clearInterval(checkInterval);
      reject(new Error(`超时未找到元素：${selector}`));
    }, timeout);
  });
}

/**
 * 休眠函数（简化版）
 * @param {number} ms - 休眠毫秒数
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ====================== 执行脚本（防重复运行） ======================
if (!window.ouluCrawling) {
  window.ouluCrawling = true;
  crawlOuluSalesData().finally(() => {
    window.ouluCrawling = false; // 执行完成后重置状态
  });
} else {
  alert('⚠️ 脚本正在执行中，请勿重复运行！');
}