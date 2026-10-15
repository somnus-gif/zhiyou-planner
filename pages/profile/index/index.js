// pages/profile/index/index.js - 我的（个人信息 / 数据概览 / 设置）
const { call } = require('../../../utils/request.js');
const app = getApp();

Page({
  data: {
    userInfo: null,
    roleText: '',
    version: '1.0.0',
    stats: { following: 0, newThisWeek: 0, tripTotal: 0, todoCount: 0 },
    statsLoading: true
  },

  onLoad() {
    if (app.globalData.isLoggedIn) {
      this.applyUser(app.globalData.userInfo);
    } else {
      app.loginReadyCallback = (info) => this.applyUser(info);
    }
    this.loadStats();
  },

  applyUser(info) {
    if (!info) return;
    this.setData({
      userInfo: info,
      roleText: info.role === 'admin' ? '管理员' : '定制师'
    });
  },

  async loadStats() {
    this.setData({ statsLoading: true });
    const stats = { ...this.data.stats };
    try {
      const res = await call('customer', { action: 'dashboard' }, { showError: false });
      const t = res.todayStats || {};
      stats.following = t.following || 0;
      stats.newThisWeek = t.newThisWeek || 0;
      stats.todoCount = t.todoCount || 0;
    } catch (e) {}
    try {
      const res = await call('tripPlan', { action: 'list', pageNo: 1, pageSize: 1 }, { showError: false });
      stats.tripTotal = res.total || 0;
    } catch (e) {}
    this.setData({ stats, statsLoading: false });
  },

  onGoTrip() {
    wx.navigateTo({ url: '/pages/trip/list/list' });
  },

  onGoScenic() {
    wx.navigateTo({ url: '/pages/scenic/list/list' });
  },

  onGoCustomers() {
    wx.switchTab({ url: '/pages/customer/list/list' });
  },

  onAbout() {
    wx.showModal({
      title: '关于智游策划师',
      content: '面向旅游从业人员的全流程策划工具：客户接待、行程规划、报价议价、合同收款、落地预订一站式完成。\n当前版本 v' + this.data.version,
      showCancel: false
    });
  },

  onContactAdmin() {
    wx.showModal({
      title: '联系管理员',
      content: '如需开通账号或调整角色权限，请联系您的管理员。',
      showCancel: false
    });
  },

  onClearCache() {
    wx.showModal({
      title: '清除本地缓存',
      content: '将清除本机缓存数据（不影响云端数据），确定继续？',
      success: (r) => {
        if (!r.confirm) return;
        try { wx.clearStorageSync(); } catch (e) {}
        wx.showToast({ title: '已清除', icon: 'success' });
      }
    });
  },

  onPullDownRefresh() {
    this.loadStats();
    setTimeout(() => wx.stopPullDownRefresh(), 600);
  }
});