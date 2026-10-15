// pages/index/index.js - 工作台首页（流程看板 + 快捷入口）
// 已接入真实 customer 云函数：dashboard 提供统计与 Tab 计数，list 提供当前阶段客户
const { STAGES, getStageColor, getStageLabel } = require('../../utils/stages.js');
const { call } = require('../../utils/request.js');
const { maskPhone, formatDateTime } = require('../../utils/format.js');

Page({
  data: {
    userInfo: null,
    todayStats: { following: 0, newThisWeek: 0, todoCount: 0 },
    stageTabs: [],
    currentStage: 'all',
    customerList: [],
    pageState: 'loading',
    demoTripId: '',         // 演示行程 id（已生成时存在）
    demoTripTitle: '',      // 演示行程标题
    // 注意：flight / hotel 两项不用于内部页面跳转。
    // onQuickTap 识别到包含 '/flight/' 或 '/hotel/' 的 path 后，会直接调用
    // wx.navigateToMiniProgram 跳转携程小程序，其 path 仅作分支标识使用，不会被 navigateTo。
    // 因此 pages/flight/list/list 与 pages/hotel/list/list 目前无实际入口。
    quickActions: [
      { key: 'newCustomer', label: '新建客户', iconChar: '新', color: '#1BA0D7', path: '/pages/customer/edit/edit' },
      { key: 'trip',        label: '行程方案', iconChar: '程', color: '#13A8A8', path: '/pages/trip/list/list' },
      { key: 'flight',      label: '机票查询', iconChar: '机', color: '#7E57C2', path: '/pages/flight/list/list' },
      { key: 'hotel',       label: '酒店查询', iconChar: '酒', color: '#FA8C16', path: '/pages/hotel/list/list' },
      { key: 'scenic',      label: '景点库',   iconChar: '景', color: '#07C160', path: '/pages/scenic/list/list' }
    ]
  },

  onLoad() {
    const stageTabs = [
      { key: 'all', label: '全部', color: '#1BA0D7', count: 0 },
      ...STAGES.filter(s => s.key !== 'lost').map(s => ({
        key: s.key, label: s.label, color: s.color, count: 0
      }))
    ];
    this.setData({ stageTabs });

    const app = getApp();
    if (app.globalData.isLoggedIn) {
      this.onLoginReady(app.globalData.userInfo);
    } else {
      app.loginReadyCallback = (info) => this.onLoginReady(info);
      // 兜底：login 超时未回调时强制加载，避免页面一直白屏/卡死
      // 设为 8 秒，容忍云函数冷启动 + 网络往返
      this._loginTimer = setTimeout(() => {
        if (!this.data.userInfo) {
          console.warn('[工作台] login 超时未回调，降级强制加载');
          this.loadAll();
        }
      }, 8000);
    }
  },

  onLoginReady(userInfo) {
    if (this._loginTimer) { clearTimeout(this._loginTimer); this._loginTimer = null; }
    this.setData({ userInfo });
    this.loadAll();
  },

  async loadAll() {
    this._loadedOnce = true;
    this.setData({ pageState: 'loading' });
    await Promise.all([
      this.loadDashboard(),
      this.loadList(),
      this.checkDemoTrip()
    ]);
  },

  // 检测是否已生成演示行程
  async checkDemoTrip() {
    try {
      const res = await call('tripPlan', {
        action: 'list',
        pageNo: 1,
        pageSize: 20
      }, { showError: false });
      const list = res.list || [];
      // 找到标题包含"演示"或"沙巴"的行程
      const demo = list.find(t => t.title && (t.title.indexOf('演示') > -1 || t.title.indexOf('沙巴') > -1 || t.title.indexOf('亚庇') > -1));
      if (demo) {
        this.setData({ demoTripId: demo._id, demoTripTitle: demo.title });
      }
    } catch (e) {
      // 忽略，可能 tripPlan 集合尚未创建
    }
  },

  async loadDashboard() {
    try {
      const res = await call('customer', { action: 'dashboard' }, { showError: false });
      const counts = res.stageCounts || {};
      const stageTabs = this.data.stageTabs.map(tab => ({
        ...tab,
        count: tab.key === 'all'
          ? Object.values(counts).reduce((a, b) => a + b, 0)
          : (counts[tab.key] || 0)
      }));
      this.setData({
        todayStats: res.todayStats || { following: 0, newThisWeek: 0, todoCount: 0 },
        stageTabs
      });
    } catch (e) {}
  },

  async loadList() {
    try {
      const res = await call('customer', {
        action: 'list',
        stage: this.data.currentStage,
        pageNo: 1,
        pageSize: 50,
        queryAll: true
      }, { showError: false });

      const list = (res.list || []).map(c => ({
        ...c,
        phoneMask: maskPhone(c.phone),
        stageLabel: getStageLabel(c.stage),
        stageColor: getStageColor(c.stage),
        updatedAtText: formatDateTime(c.updatedAt)
      }));

      this.setData({
        customerList: list,
        pageState: list.length ? 'list' : 'empty'
      });
    } catch (e) {
      this.setData({ pageState: 'error' });
    }
  },

  onStageTap(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.currentStage) return;
    this.setData({ currentStage: key, pageState: 'loading' });
    this.loadList();
  },

  onCustomerTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/customer/detail/detail?id=${id}` });
  },

  onQuickTap(e) {
    const path = e.currentTarget.dataset.path;
    if (!path) return;
    if (path.startsWith('/pages/customer/list')) {
      wx.switchTab({ url: path.split('?')[0] });
    } else if (path.includes('/flight/')) {
      wx.navigateToMiniProgram({
        appId: 'wx0e6ed4f51db9d078',
        success() { wx.showToast({ title: '跳转成功', icon: 'success' }); },
        fail(err) {
          console.error('机票跳转失败:', err);
          wx.showModal({ title: '跳转失败', content: err.errMsg || JSON.stringify(err), showCancel: false });
        }
      });
    } else if (path.includes('/hotel/')) {
      wx.navigateToMiniProgram({
        appId: 'wx0e6ed4f51db9d078',
        success() { wx.showToast({ title: '跳转成功', icon: 'success' }); },
        fail(err) {
          console.error('酒店跳转失败:', err);
          wx.showModal({ title: '跳转失败', content: err.errMsg || JSON.stringify(err), showCancel: false });
        }
      });
    } else {
      wx.navigateTo({ url: path });
    }
  },

  // 调试入口：一键生成演示行程并查看客户展示页
  async onInitDemo() {
    wx.showModal({
      title: '生成演示数据',
      content: '将创建「马来西亚·沙巴 亚庇+仙本那7天6晚」演示行程（含演示客户、景点、酒店、接机信息），生成后直接进入客户展示页查看效果。',
      confirmText: '生成',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          const res = await call('tripPlan', { action: 'initDemo' }, { loading: true });
          if (res && res.tripId) {
            this.setData({ demoTripId: res.tripId, demoTripTitle: res.title || '演示行程' });
            wx.showToast({ title: '已生成', icon: 'success' });
            setTimeout(() => {
              wx.navigateTo({ url: '/pages/trip/showcase/showcase?id=' + res.tripId });
            }, 600);
          }
        } catch (e) {}
      }
    });
  },

  // 直接查看演示行程展示页
  onViewDemoTrip() {
    if (this.data.demoTripId) {
      wx.navigateTo({ url: '/pages/trip/showcase/showcase?id=' + this.data.demoTripId });
    } else {
      // 如果还没检测到，先尝试快速查询一次
      this.checkDemoTrip().then(() => {
        if (this.data.demoTripId) {
          wx.navigateTo({ url: '/pages/trip/showcase/showcase?id=' + this.data.demoTripId });
        } else {
          // 没有演示行程，引导生成
          this.onInitDemo();
        }
      });
    }
  },

  // 从新建/编辑客户等页面返回时刷新，避免列表停留在旧数据（首次进入由 onLoad 负责）
  onShow() {
    if (this._loadedOnce) this.loadAll();
  },

  onPullDownRefresh() {
    this.loadAll();
    setTimeout(() => wx.stopPullDownRefresh(), 800);
  },

  onRetry() {
    this.loadAll();
  }
});
