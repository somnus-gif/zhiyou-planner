// app.js - 智游策划师小程序入口
App({
  // 全局状态：登录用户信息、白名单校验结果
  globalData: {
    userInfo: null,         // { _openid, nickName, avatarUrl, role, name, phone }
    openid: null,           // 当前用户 openid
    isLoggedIn: false,      // 登录态
    env: 'develop',        // 云环境：develop / prod
    cloudEnvId: 'cloud1-d5gwyk6x9796cfc46'    // 云开发环境 ID（云开发控制台 → 环境名下拉可见，须带后缀，仅填名称会报 Env Not Exists）
  },

  onLaunch() {
    // 初始化云开发
    if (!wx.cloud) {
      console.error('[智游] 当前微信版本不支持云开发，请升级微信基础库到 2.2.3+');
      return;
    }
    const cloudConfig = { traceUser: true };
    if (this.globalData.cloudEnvId) cloudConfig.env = this.globalData.cloudEnvId;
    wx.cloud.init(cloudConfig);

    // 启动时做一次静默登录，校验内部员工白名单
    this.silentLogin();
  },

  /**
   * 静默登录：调用 login 云函数获取 openid + 角色
   * 内部工具：仅邀请码/白名单内的微信用户可使用
   */
  silentLogin() {
    wx.cloud.callFunction({
      name: 'login',
      data: { action: 'login' }
    }).then(res => {
      const r = res.result || {};
      if (r.code === 0 && r.data) {
        this.globalData.userInfo = r.data;
        this.globalData.openid = r.data.openid;
        this.globalData.isLoggedIn = true;
        // 触发全局登录成功回调（页面可监听 this.onLoginReady）
        if (this.loginReadyCallback) this.loginReadyCallback(r.data);
      } else {
        // 未在白名单内，引导至申请权限页
        console.warn('[智游] 登录受限:', r.message);
      }
    }).catch(err => {
      console.error('[智游] 登录失败:', err);
    });
  }
});
