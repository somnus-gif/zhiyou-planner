// pages/scenic/detail/detail.js - 景点详情（含图片管理：上传/删除/设为封面/预览）
const { call } = require('../../../utils/request.js');
const { formatMoney } = require('../../../utils/format.js');

Page({
  data: {
    id: '',
    pageState: 'loading',
    scenic: null,
    gallery: [],          // 轮播图列表（含封面）
    imageList: [],        // 所有图片数组（用于管理）
    initial: '',
    priceText: '',
    editMode: false,      // 图片编辑模式
    uploading: false,
    uploadProgress: 0
  },

  onLoad(options) {
    if (!options.id) {
      wx.showToast({ title: '缺少景点 id', icon: 'none' });
      return;
    }
    this.setData({ id: options.id });
    this.loadDetail();
  },

  onShow() {
    if (this.data.id && this.data.scenic) this.loadDetail();
  },

  async loadDetail() {
    try {
      const res = await call('scenic', { action: 'get', id: this.data.id }, { showError: false });
      const s = res.scenic || {};
      // 图片列表：封面 + 图集（去重）
      const allImgs = [];
      if (s.coverImage) allImgs.push(s.coverImage);
      (s.images || []).forEach(img => {
        if (img && img !== s.coverImage) allImgs.push(img);
      });

      this.setData({
        scenic: {
          ...s,
          highlights: s.highlights || [],
          suitableFor: s.suitableFor || [],
          tags: s.tags || []
        },
        gallery: allImgs,
        imageList: allImgs,
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

  // ========== 图片管理 ==========
  toggleEditMode() {
    this.setData({ editMode: !this.data.editMode });
  },

  async onUploadImages() {
    if (this.data.uploading) return;
    try {
      const chooseRes = await wx.chooseMedia({
        count: 9,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed']
      });
      const tempFiles = chooseRes.tempFiles || [];
      if (!tempFiles.length) return;

      this.setData({ uploading: true, uploadProgress: 0 });
      wx.showLoading({ title: '上传中 0/' + tempFiles.length, mask: true });

      const oldImages = (this.data.scenic && this.data.scenic.images) || [];
      const oldCover = (this.data.scenic && this.data.scenic.coverImage) || '';
      const newFileIDs = [];

      // 逐张上传，显示进度
      for (let i = 0; i < tempFiles.length; i++) {
        try {
          const cloudPath = `scenic/${this.data.id}_${Date.now()}_${i}.jpg`;
          const res = await wx.cloud.uploadFile({
            cloudPath,
            filePath: tempFiles[i].tempFilePath
          });
          newFileIDs.push(res.fileID);
          wx.showLoading({ title: '上传中 ' + (i + 1) + '/' + tempFiles.length, mask: true });
          this.setData({ uploadProgress: Math.round((i + 1) / tempFiles.length * 100) });
        } catch (e) {
          console.error('单张上传失败:', e);
        }
      }

      if (!newFileIDs.length) {
        wx.hideLoading();
        this.setData({ uploading: false });
        wx.showToast({ title: '上传失败', icon: 'none' });
        return;
      }

      // 合并图片（新图在前）
      const allImages = oldImages.concat(newFileIDs);
      const coverImage = oldCover || newFileIDs[0];

      await call('scenic', {
        action: 'update',
        id: this.data.id,
        coverImage,
        images: allImages
      });

      wx.hideLoading();
      this.setData({ uploading: false, editMode: false });
      wx.showToast({ title: '已上传' + newFileIDs.length + '张', icon: 'success' });
      this.loadDetail();
    } catch (err) {
      wx.hideLoading();
      this.setData({ uploading: false });
      if (err.errMsg && err.errMsg.includes('cancel')) return;
      wx.showToast({ title: '上传失败', icon: 'none' });
    }
  },

  async onSetCover(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    try {
      await call('scenic', {
        action: 'update',
        id: this.data.id,
        coverImage: url
      });
      wx.showToast({ title: '已设为封面', icon: 'success' });
      this.loadDetail();
    } catch (e) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  async onDeleteImage(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    const s = this.data.scenic;
    if (!s) return;

    const isCover = url === s.coverImage;
    const title = isCover ? '删除封面图？' : '删除这张图片？';
    const r = await new Promise(resolve => {
      wx.showModal({
        title,
        content: '删除后无法恢复',
        confirmText: '删除',
        confirmColor: '#FF4D4F',
        success: resolve
      });
    });
    if (!r.confirm) return;

    wx.showLoading({ title: '删除中...', mask: true });
    try {
      const oldImages = s.images || [];
      const newImages = oldImages.filter(img => img !== url);
      let newCover = s.coverImage;

      if (isCover) {
        // 删除了封面，取第一张图作为新封面
        newCover = newImages[0] || '';
      }

      await call('scenic', {
        action: 'update',
        id: this.data.id,
        coverImage: newCover,
        images: newImages
      });

      // 尝试删除云存储文件（fileID）
      try {
        if (url.startsWith('cloud://')) {
          await wx.cloud.deleteFile({ fileList: [url] });
        }
      } catch (e) {
        console.warn('云存储文件删除失败:', e);
      }

      wx.hideLoading();
      wx.showToast({ title: '已删除', icon: 'success' });
      this.loadDetail();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },

  // ========== 视频上传 ==========
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
      wx.showLoading({ title: '视频上传中...', mask: true });
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

  async onDeleteVideo() {
    const s = this.data.scenic;
    if (!s || !s.videoUrl) return;
    const r = await new Promise(resolve => {
      wx.showModal({
        title: '删除视频？',
        content: '删除后无法恢复',
        confirmText: '删除',
        confirmColor: '#FF4D4F',
        success: resolve
      });
    });
    if (!r.confirm) return;
    wx.showLoading({ title: '删除中...' });
    try {
      await call('scenic', { action: 'update', id: this.data.id, videoUrl: '' });
      try {
        if (s.videoUrl.startsWith('cloud://')) {
          await wx.cloud.deleteFile({ fileList: [s.videoUrl] });
        }
      } catch (e) {}
      wx.hideLoading();
      wx.showToast({ title: '已删除', icon: 'success' });
      this.loadDetail();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },

  // ========== 游玩方式编辑 ==========
  onEditPlayGuide() {
    const s = this.data.scenic;
    if (!s) return;
    this.setData({ guideSheet: { show: true, text: s.playGuide || '' } });
  },

  onGuideInput(e) {
    this.setData({ 'guideSheet.text': e.detail.value });
  },

  onGuideCancel() {
    this.setData({ 'guideSheet.show': false });
  },

  async onGuideSave() {
    const text = (this.data.guideSheet.text || '').trim();
    try {
      await call('scenic', { action: 'update', id: this.data.id, playGuide: text });
      this.setData({ 'guideSheet.show': false });
      wx.showToast({ title: '已保存', icon: 'success' });
      this.loadDetail();
    } catch (e) {}
  },

  noop() {},
  // ========== 分享 & 复制 ==========
  onShareAppMessage() {
    const s = this.data.scenic || {};
    return {
      title: s.name ? '推荐景点：' + s.name : '智游策划师 - 景点推荐',
      path: '/pages/scenic/detail/detail?id=' + this.data.id,
      imageUrl: s.coverImage || ''
    };
  },

  onEdit() {
    wx.navigateTo({ url: '/pages/scenic/edit/edit?id=' + this.data.id });
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
  }
});
