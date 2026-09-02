/* =========================================================
   Linki — 中英文切换（默认英文）
   ========================================================= */
(function () {
  'use strict';

  var STORAGE_KEY = 'linki-lang';

  var I18N = {
    'nav.ariaLabel': { en: 'Primary navigation', zh: '主导航' },
    'nav.menuAria': { en: 'Menu', zh: '菜单' },
    'nav.home': { en: 'Home', zh: '首页' },
    'nav.features': { en: 'Features', zh: '功能' },
    'nav.specs': { en: 'Specs', zh: '规格' },
    'nav.contact': { en: 'Contact', zh: '联系我们' },
    'lang.toggleAria': { en: 'Switch to Chinese', zh: 'Switch to English' },
    'lang.toggleLabel': { en: '中文', zh: 'EN' },
    'nav.cta': { en: 'Join now', zh: '立即加入' },

    'hero.eyebrow': { en: 'A little life on your desk', zh: '桌面上的一只小生命' },
    'hero.title': {
      en: 'Every touch, a little surprise<br />Every day, real company',
      zh: '每一次触摸<br />都是惊喜<br />每一天陪伴<br />都很真实',
    },
    'hero.sub': {
      en: 'No camera, more peace of mind. It shares the same seasons with you, keeping you company in the most natural way, every single day.',
      zh: '没有摄像头，更安心。和你共享同一片四季，用最自然的方式，陪你度过每一天。',
    },
    'hero.cta': { en: 'Learn more', zh: '立即了解' },

    'intro.eyebrow': { en: 'System capabilities', zh: '系统能力' },
    'intro.title': {
      en: "It doesn't need your time<br />yet it reads the moment",
      zh: '它不需要你的时间<br />也能读懂此刻',
    },
    'intro.copy': {
      en: 'Environmental sensing, scene sync and instant response—packed into a single desktop device.',
      zh: '环境感知、场景同步与即时反馈，收进一台桌面设备里。',
    },

    'highlight1.videoAria': { en: 'Video of Linki changing with the seasons', zh: '灵奇随四季变换的场景视频' },
    'highlight1.kicker': { en: '01 / Scene sync', zh: '01 / 场景同步' },
    'highlight1.title': { en: 'Sharing the same seasons with you', zh: '和你共享同一片四季' },
    'highlight1.desc': {
      en: 'Time, weather and season all map into the world inside its screen.',
      zh: '时间、天气与季节的变化，都映射进它的屏内世界。',
    },

    'highlight2.videoAria': { en: 'Video of millimeter-wave presence sensing on the desk', zh: '毫米波感知桌面在场的视频' },
    'highlight2.kicker': { en: '02 / Peace of mind', zh: '02 / 更安心的陪伴' },
    'highlight2.title': { en: 'A companion on your desk—not a camera', zh: '桌上多一个伙伴，不多一只眼睛' },
    'highlight2.desc': {
      en: 'It senses your presence and lingering—no camera, no images ever stored.',
      zh: '感知你的靠近与停留，不用摄像头、不留任何影像。',
    },

    'highlight3.kicker': { en: '03 / Instant response', zh: '03 / 即时反馈' },
    'highlight3.title': { en: 'No two touches are alike', zh: '每一次触碰，都不重复' },
    'highlight3.desc': {
      en: "A touch isn't a command but a light conversation—always keeping a little of the unknown.",
      zh: '触控不是命令，而是一次轻量的对话，回应始终保留一点未知。',
    },
    'highlight3.videoAria': { en: 'Video of Linki reacting randomly after a finger touch', zh: '手指触碰后灵奇随机反应的视频' },

    'highlight4.kicker': { en: '04 / Magnetic modules', zh: '04 / 磁吸换装' },

    'module.controlsAria': { en: 'Switch scenes', zh: '使用场景切换' },
    'module.prevAria': { en: 'Previous scene', zh: '查看上一个场景' },
    'module.nextAria': { en: 'Next scene', zh: '查看下一个场景' },
    'module.railAria': { en: 'Swipe to browse real-life scenes', zh: '可左右滑动浏览的真实使用场景' },
    'module.slide1Alt': {
      en: 'Working late at night, a man reaches out to play with Linki on his desk',
      zh: '夜里加班，男生伸手逗了逗桌上的灵奇',
    },
    'module.slide2Alt': {
      en: 'Focused at the desk, Linki quietly keeps company nearby',
      zh: '办公桌前专注工作，灵奇安静陪在一旁',
    },
    'module.slide3Alt': {
      en: 'A user gently touches Linki and the on-screen hamster wakes in response',
      zh: '用户轻触灵奇，屏内仓鼠醒来回应',
    },
    'module.bodyTitle': { en: 'It just blends into your everyday', zh: '它就这样，融进你的日常' },
    'module.bodyDesc': {
      en: 'Working, daydreaming, burning the midnight oil—Linki stays quietly at the corner of your desk.',
      zh: '工作、发呆、深夜加班——灵奇一直安静地待在桌角。',
    },

    'specs.eyebrow': { en: 'Cool tech · Warm core', zh: '冷科技 · 暖内核' },
    'specs.title': { en: "Care you can't see", zh: '看不见的用心' },
    'spec1.title': { en: 'Naked-eye 3D display', zh: '裸眼 3D 立体显示' },
    'spec1.desc': {
      en: 'Dynamic imagery with real spatial depth inside the transparent body—no glasses needed.',
      zh: '透明主体内的动态画面自带空间层次，无需佩戴任何设备。',
    },
    'spec2.title': { en: 'Non-visual environmental sensing', zh: '非视觉环境感知' },
    'spec2.desc': {
      en: 'Millimeter-wave radar with a four-microphone array senses the room—no camera at all.',
      zh: '毫米波雷达配合四麦克风阵列感知环境，全程无摄像头。',
    },
    'spec3.title': { en: 'Magnetic character interface', zh: '磁吸角色接口' },
    'spec3.desc': {
      en: 'A top magnetic module links the physical form to the digital character, always expandable.',
      zh: '顶部磁吸模块连接实体造型与数字角色，可持续扩展。',
    },

    'modules.title': { en: 'Five expressions, one magnetic snap', zh: '五种表情，磁吸即换' },
    'modules.copy': {
      en: "Swap the ear module and the on-screen character changes with it. Tap a card to draw it to the front.",
      zh: '换上不同的耳朵模块，屏幕里的角色也跟着变身。点一张卡牌，把它抽到最前面。',
    },
    'modules.hint': { en: 'Tap a card to draw it to the front', zh: '点击卡牌，把它抽到最前面' },
    'modules.fanAria': { en: 'Ear module cards, tap to draw', zh: '耳朵模块卡片，点击抽取' },
    'modules.panda': { en: 'Panda', zh: '熊猫' },
    'modules.pig': { en: 'Piglet', zh: '小猪' },
    'modules.shiba': { en: 'Shiba Inu', zh: '柴犬' },
    'modules.fox': { en: 'Fox', zh: '狐狸' },
    'modules.rabbit': { en: 'Rabbit', zh: '兔子' },

    'newsletter.title': { en: 'Join the world of Linki', zh: '加入灵奇的世界' },
    'newsletter.desc': {
      en: 'Leave your details and we will share product updates, trial access and partnership notes.',
      zh: '留下联系方式，我们会把新品进展、试用名额和合作信息同步给你。',
    },
    'newsletter.cta': { en: 'Join now', zh: '立即加入' },

    'form.name': { en: 'Name', zh: '姓名' },
    'form.namePlaceholder': { en: 'Your name', zh: '你的姓名' },
    'form.email': { en: 'Email', zh: '邮箱' },
    'form.contact': { en: 'Contact', zh: '微信 / 电话' },
    'form.contactPlaceholder': { en: 'Optional phone or messaging ID', zh: '选填，方便进一步联系' },
    'form.intent': { en: 'Interest', zh: '关注方向' },
    'form.intentSelect': { en: 'Select one', zh: '请选择' },
    'form.intentPreorder': { en: 'Preorder', zh: '新品预订' },
    'form.intentExperience': { en: 'Trial experience', zh: '试用体验' },
    'form.intentPartnership': { en: 'Channel / partnership', zh: '渠道 / 商务合作' },
    'form.intentMedia': { en: 'Media inquiry', zh: '媒体咨询' },
    'form.intentOther': { en: 'Other', zh: '其他' },
    'form.featuresLegend': { en: 'Which Linki features matter most to you?', zh: '灵奇的哪些亮点最吸引你？' },
    'form.featuresHelper': {
      en: 'Pick anything you care about—it shapes what we build next.',
      zh: '选择你在意的方向，这会影响我们接下来的打磨重点。',
    },
    'form.feature.seasons': { en: 'Season-synced screen', zh: '四季同步屏幕' },
    'form.feature.presence': { en: 'Camera-free presence sensing', zh: '无摄像头存在感知' },
    'form.feature.touch': { en: 'Responsive touch interaction', zh: '触摸即时反馈' },
    'form.feature.display3d': { en: 'Naked-eye 3D display', zh: '裸眼 3D 立体显示' },
    'form.feature.envSensing': { en: 'Non-visual environmental sensing', zh: '非视觉环境感知' },
    'form.feature.magnetic': { en: 'Magnetic character interface', zh: '磁吸角色接口' },
    'form.message': { en: 'Message', zh: '留言' },
    'form.messagePlaceholder': { en: 'Questions, use cases or collaboration ideas', zh: '想了解的问题、使用场景或合作想法' },
    'form.submit': { en: 'Submit', zh: '提交' },
    'form.loading': { en: 'Submitting…', zh: '提交中…' },

    'footer.tagline': { en: 'A companion pet made for cyber life.', zh: '为赛博生活而生的陪伴宠物。' },
    'footer.productHeading': { en: 'Product', zh: '产品' },
    'footer.productLinki': { en: 'Linki', zh: '灵奇' },
    'footer.productFeatures': { en: 'Features', zh: '功能' },
    'footer.productSpecs': { en: 'Specs', zh: '规格' },
    'footer.supportHeading': { en: 'Support', zh: '支持' },
    'footer.supportFaq': { en: 'FAQ', zh: '常见问题' },
    'footer.supportShipping': { en: 'Shipping', zh: '配送政策' },
    'footer.supportContact': { en: 'Contact', zh: '联系我们' },
    'footer.followHeading': { en: 'Follow us', zh: '关注我们' },
  };

  function applyLang(lang) {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var entry = I18N[el.getAttribute('data-i18n')];
      if (entry) el.textContent = entry[lang];
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var entry = I18N[el.getAttribute('data-i18n-html')];
      if (entry) el.innerHTML = entry[lang];
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      var entry = I18N[el.getAttribute('data-i18n-aria')];
      if (entry) el.setAttribute('aria-label', entry[lang]);
    });
    document.querySelectorAll('[data-i18n-alt]').forEach(function (el) {
      var entry = I18N[el.getAttribute('data-i18n-alt')];
      if (entry) el.setAttribute('alt', entry[lang]);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var entry = I18N[el.getAttribute('data-i18n-placeholder')];
      if (entry) el.setAttribute('placeholder', entry[lang]);
    });

    var form = document.getElementById('newsletterForm');
    if (form) {
      form.dataset.submitLabel = I18N['form.submit'][lang];
      form.dataset.loadingLabel = I18N['form.loading'][lang];
      var submitButton = form.querySelector('button[type="submit"]');
      if (submitButton) submitButton.textContent = I18N['form.submit'][lang];
    }

    var toggle = document.getElementById('langToggle');
    if (toggle) {
      toggle.textContent = I18N['lang.toggleLabel'][lang];
      toggle.setAttribute('aria-label', I18N['lang.toggleAria'][lang]);
    }

    localStorage.setItem(STORAGE_KEY, lang);
  }

  var initialLang = localStorage.getItem(STORAGE_KEY) === 'zh' ? 'zh' : 'en';
  applyLang(initialLang);

  var toggleButton = document.getElementById('langToggle');
  if (toggleButton) {
    toggleButton.addEventListener('click', function () {
      applyLang(document.documentElement.lang === 'en' ? 'zh' : 'en');
    });
  }
})();
