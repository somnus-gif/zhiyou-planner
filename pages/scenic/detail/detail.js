// pages/scenic/detail/detail.js - 景点详情
const { call } = require('../../../utils/request.js');
const { formatMoney } = require('../../../utils/format.js');

Page({
  data: {
    id: '',
    pageState: 'loading',
    scenic: null,
    gallery: [],
    initial: '',
    priceText: ''
  },

  onLoad(options) {
    if (!options.id) {
      wx.showToast({ title: '缺少景点 id', icon: 'none' });
      return;
    }
    this.setData({ id: options.id });
    this.loadDetail();
  },

  async loadDetail() {
    try {
      const res = await call('scenic', { action: 'get', id: this.data.id }, { showError: false });
      const s = res.scenic || {};
      const gallery = [s.coverImage].concat(s.images || []).filter(Boolean);

      this.setData({
        scenic: {
          ...s,
          highlights: s.highlights || [],
          suitableFor: s.suitableFor || [],
          tags: s.tags || []
        },
        gallery,
        initial: s.name ? s.name[0] : '',
        priceText: s.ticketPrice ? formatMoney(s.ticketPrice) + ' 元' : '免费开放',
        pageState: 'ok'
      });
      wx.setNavigationBarTitle({ title: s.name || '景点详情' });
    } catch (e) {
      this.setData({ pageState: 'error' });
    }
  },

  onPreviewImage(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    if (!this.data.gallery.length) return;
    wx.previewImage({
      current: this.data.gallery[idx],
      urls: this.data.gallery
    });
  },

  onShareAppMessage() {
    const s = this.data.scenic || {};
    return {
      title: s.name ? '推荐景点：' + s.name : '智游策划师 - 景点推荐',
      path: '/pages/scenic/detail/detail?id=' + this.data.id,
      imageUrl: s.coverImage || ''
    };
  },

  onCopyIntro() {
    const s = this.data.scenic;
    if (!s) return;
    const text = `${s.name}\n${s.intro || ''}\n门票：${this.data.priceText}\n建议游玩：${s.duration || 0} 小时`;
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制介绍', icon: 'success' })
    });
  },

  onRetry() {
    this.loadDetail();
  },

  async onUploadCover() {
    try {
      const chooseRes = await wx.chooseMedia({
        count: 9,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed']
      });
      const tempFiles = chooseRes.tempFiles || [];
      if (!tempFiles.length) return;
      wx.showLoading({ title: '上传中(' + tempFiles.length + '张)...' });
      const oldImages = (this.data.scenic && this.data.scenic.images) || [];
      const uploadTasks = tempFiles.map((f, i) => {
        const cloudPath = `scenic/${this.data.id}_${Date.now()}_${i}.jpg`;
        return wx.cloud.uploadFile({ cloudPath, filePath: f.tempFilePath });
      });
      const results = await Promise.all(uploadTasks);
      const newImages = results.map(r => r.fileID);
      const allImages = oldImages.concat(newImages);
      const coverImage = (this.data.scenic && this.data.scenic.coverImage) || newImages[0] || '';
      await call('scenic', {
        action: 'update',
        id: this.data.id,
        coverImage,
        images: allImages
      });
      wx.hideLoading();
      wx.showToast({ title: '已上传' + newImages.length + '张', icon: 'success' });
      this.loadDetail();
    } catch (err) {
      wx.hideLoading();
      if (err.errMsg && err.errMsg.includes('cancel')) return;
      wx.showToast({ title: '上传失败', icon: 'none' });
    }
  },

  async onUploadVideo() {
    try {
      const chooseRes = await wx.chooseMedia({
        count: 1,
        mediaType: ['video'],
        sourceType: ['album', 'camera'],
        maxDuration: 60,
        camera: 'back'
      });
      const tempFile = (chooseRes.tempFiles || [])[0];
      if (!tempFile) return;
      wx.showLoading({ title: '视频上传中...' });
      const cloudPath = `scenic/${this.data.id}_video_${Date.now()}.mp4`;
      const res = await wx.cloud.uploadFile({ cloudPath, filePath: tempFile.tempFilePath });
      await call('scenic', { action: 'update', id: this.data.id, videoUrl: res.fileID });
      wx.hideLoading();
      wx.showToast({ title: '视频已上传', icon: 'success' });
      this.loadDetail();
    } catch (err) {
      wx.hideLoading();
      if (err.errMsg && err.errMsg.includes('cancel')) return;
      wx.showToast({ title: '视频上传失败', icon: 'none' });
    }
  },

  onEditPlayGuide() {
    const s = this.data.scenic;
    if (!s) return;
    const current = s.playGuide || '';
    wx.showModal({
      title: '编辑游玩方式',
      editable: true,
      placeholderText: '如：建议上午前往，光线最佳...',
      content: current,
      success: async (r) => {
        if (!r.confirm) return;
        const text = (r.content || '').trim();
        try {
          await call('scenic', { action: 'update', id: this.data.id, playGuide: text });
          wx.showToast({ title: '已保存', icon: 'success' });
          this.loadDetail();
        } catch (e) {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      }
    });
  }
});
