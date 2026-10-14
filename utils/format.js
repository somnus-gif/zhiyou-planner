// utils/format.js - 通用格式化工具

/**
 * 金额格式化：分 → 元，保留 2 位小数 + 千分位
 * 数据库金额统一用分存储，展示时转元
 */
function formatMoney(cents) {
  if (cents == null || isNaN(cents)) return '0.00';
  const yuan = Number(cents) / 100;
  return yuan.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function daysBetween(startStr, endStr) {
  if (!startStr || !endStr) return 0;
  const s = new Date(startStr).getTime();
  const e = new Date(endStr).getTime();
  if (isNaN(s) || isNaN(e)) return 0;
  return Math.floor((e - s) / (24 * 3600 * 1000)) + 1;
}

function maskPhone(phone) {
  if (!phone || phone.length < 7) return phone || '';
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

module.exports = {
  formatMoney,
  formatDate,
  formatDateTime,
  daysBetween,
  maskPhone
};
