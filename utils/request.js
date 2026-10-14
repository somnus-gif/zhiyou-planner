// utils/request.js - 云函数调用统一封装
// 统一处理：loading / 错误提示 / 鉴权失败跳转 / 超时重试

/**
 * 调用云函数
 * @param {string} name 云函数名
 * @param {object} data 入参
 * @param {object} opts { loading:boolean, showError:boolean, retry:number }
 * @returns {Promise<object>} 云函数返回的 data 字段
 */
function call(name, data = {}, opts = {}) {
  const { loading = false, showError = true, retry = 0 } = opts;

  if (loading) {
    wx.showLoading({ title: '处理中...', mask: true });
  }

  return new Promise((resolve, reject) => {
    const invoke = (left) => {
      wx.cloud.callFunction({
        name,
        data,
        success: res => {
          if (loading) wx.hideLoading();
          const r = res.result || {};
          // 约定云函数返回 { code, message, data }，code === 0 视为成功
          if (r.code === 0) {
            resolve(r.data);
          } else if (r.code === 403 || r.code === 401) {
            if (showError) {
              wx.showModal({
                title: '无访问权限',
                content: r.message || '您不在内部员工白名单内，请联系管理员',
                showCancel: false
              });
            }
            reject(r);
          } else {
            if (showError) {
              wx.showToast({ title: r.message || '操作失败', icon: 'none' });
            }
            reject(r);
          }
        },
        fail: err => {
          if (loading) wx.hideLoading();
          if (left > 0) {
            setTimeout(() => invoke(left - 1), 500);
          } else {
            if (showError) {
              wx.showToast({ title: '网络异常，请重试', icon: 'none' });
            }
            reject(err);
          }
        }
      });
    };
    invoke(retry);
  });
}

const db = () => wx.cloud.database();
const _ = () => wx.cloud.database().command;

module.exports = {
  call,
  db,
  _
};
