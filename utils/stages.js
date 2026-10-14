// utils/stages.js - 业务全流程阶段定义
// 阶段流转：接待 → 规划 → 报价 → 议价 → 定金 → 合同 → 尾款 → 预订 → 资料下发 → 出行中 → 已完成
// 每个阶段对应：key(数据库存储) / label(显示名) / color(标签色) / icon(预留)

const STAGES = [
  { key: 'receive',    label: '接待',    color: '#1BA0D7', desc: '客户接待，需求初步沟通' },
  { key: 'plan',       label: '规划',    color: '#3B7DDB', desc: '行程规划中' },
  { key: 'quote',      label: '报价',    color: '#7E57C2', desc: '已生成报价单，待客户确认' },
  { key: 'bargain',    label: '议价',    color: '#FF9F2C', desc: '客户砍价，多轮调价中' },
  { key: 'deposit',    label: '定金',    color: '#FAAD14', desc: '已确认价格，待收定金' },
  { key: 'contract',   label: '合同',    color: '#13C2C2', desc: '合同签署中' },
  { key: 'balance',    label: '尾款',    color: '#FA8C16', desc: '合同已签，待收尾款' },
  { key: 'booking',    label: '预订',    color: '#2F54EB', desc: '落地预订：酒店/门票/地接对接' },
  { key: 'doc',        label: '资料下发', color: '#08979C', desc: '入住函/行程单已下发' },
  { key: 'traveling',  label: '出行中',   color: '#52C41A', desc: '客户行程进行中' },
  { key: 'done',       label: '已完成',   color: '#07C160', desc: '行程结束，已归档' },
  { key: 'lost',       label: '已流失',   color: '#BFBFBF', desc: '客户未成交，已关闭' }
];

// key -> stage 映射，便于 O(1) 查找
const STAGE_MAP = STAGES.reduce((acc, s) => {
  acc[s.key] = s;
  return acc;
}, {});

/**
 * 根据 stage key 获取阶段定义
 * @param {string} key
 */
function getStage(key) {
  return STAGE_MAP[key] || STAGES[0];
}

function getStageLabel(key) {
  return (STAGE_MAP[key] || {}).label || '未知';
}

function getStageColor(key) {
  return (STAGE_MAP[key] || {}).color || '#8C8C8C';
}

/**
 * 获取下一个阶段 key（用于"推进阶段"按钮）
 * 已完成 / 已流失 为终态，返回自身
 */
function getNextStage(key) {
  const idx = STAGES.findIndex(s => s.key === key);
  if (idx < 0 || idx >= STAGES.length - 3) return key; // 终态
  return STAGES[idx + 1].key;
}

function getStageIndex(key) {
  return STAGES.findIndex(s => s.key === key);
}

module.exports = {
  STAGES,
  STAGE_MAP,
  getStage,
  getStageLabel,
  getStageColor,
  getNextStage,
  getStageIndex
};
