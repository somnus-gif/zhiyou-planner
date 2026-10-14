// pages/profile/index/index.js - 我的（占位，后续可扩展设置/关于）
const app = getApp();
Page({
  data: {
    userInfo: null,
    version: '1.0.0'
  },
  onLoad() {
    if (app.globalData.isLoggedIn) {
      this.setData({ userInfo: app.globalData.userInfo });
    } else {
      app.loginReadyCallback = (info) => this.setData({ userInfo: info });
    }
  }
});
