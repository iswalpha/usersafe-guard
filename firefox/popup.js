// Firefox 兼容性
const isFirefox = typeof browser !== 'undefined';
const runtime = isFirefox ? browser : chrome;
const storage = isFirefox ? browser.storage : chrome.storage;
const tabs = isFirefox ? browser.tabs : chrome.tabs;

document.addEventListener('DOMContentLoaded', function() {
    
    const statusElement = document.getElementById('status');
    const statusDescElement = document.getElementById('statusDesc');
    const scriptsListElement = document.getElementById('scriptsList');
    const lastScanElement = document.getElementById('lastScan');
    const reportBtn = document.getElementById('reportBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    const autoSendToggle = document.getElementById('autoSendToggle');
    const serviceStatusElement = document.getElementById('serviceStatus');

    let currentScripts = [];
    let analysisResults = [];
    let currentTabInfo = { url: '', title: '' };

    // 初始化
    init();

    // 仿冒上报按钮
    reportBtn.addEventListener('click', reportFakeWebsite);

    // 设置按钮
    settingsBtn.addEventListener('click', function() {
        runtime.runtime.openOptionsPage();
    });

    // 自动发送开关
    autoSendToggle.addEventListener('change', function() {
        storage.sync.set({autoSend: this.checked});
        showMessage(`自动分析已${this.checked ? '开启' : '关闭'}`, 'info');
    });

    // 改进的初始化函数
    async function init() {
        
        try {
            // 获取当前标签页信息
            await getCurrentTabInfo();
            
            // 加载设置
            const result = await new Promise(resolve => {
                storage.sync.get(['autoSend', 'serviceAvailable', 'serviceUrl'], resolve);
            });
            autoSendToggle.checked = result.autoSend !== false;
            
            // 显示服务状态
            updateServiceStatus(result.serviceAvailable);
            
            if (serviceStatusElement) {
                const serviceUrl = result.serviceUrl || 'http://127.0.0.1:8500/checkurl';
                serviceStatusElement.setAttribute('title', `服务地址: ${serviceUrl}`);
            }
            
            // 开始扫描
            await scanPage();
            
        } catch (error) {
            showErrorState('初始化失败: ' + error.message);
        }
    }

    // 获取当前标签页信息
    async function getCurrentTabInfo() {
        return new Promise((resolve, reject) => {
            // 使用全局的 tabs 变量，而不是重新声明
            tabs.query({active: true, currentWindow: true}, function(tabs) {
                if (runtime.runtime.lastError) {
                    reject(runtime.runtime.lastError);
                    return;
                }
                
                if (tabs && tabs.length > 0) {
                    currentTabInfo.url = tabs[0].url || '';
                    currentTabInfo.title = tabs[0].title || '';
                    resolve(currentTabInfo);
                } else {
                    reject(new Error('未找到活动标签页'));
                }
            });
        });
    }

    function updateServiceStatus(available) {
        if (serviceStatusElement) {
            if (available === undefined) {
                serviceStatusElement.textContent = '🔍 检查服务状态...';
                serviceStatusElement.style.color = '#ff9800';
            } else if (available) {
                serviceStatusElement.textContent = '✅ 服务连接正常';
                serviceStatusElement.style.color = '#4caf50';
            } else {
                serviceStatusElement.textContent = '❌ 服务未连接';
                serviceStatusElement.style.color = '#f44336';
            }
        }
    }

    // 改进的扫描函数
    async function scanPage() {
        setScanningState();
        
        try {
            const tabList = await new Promise((resolve, reject) => {
                // 使用全局的 tabs 变量
                tabs.query({active: true, currentWindow: true}, (tabs) => {
                    if (runtime.runtime.lastError) {
                        reject(runtime.runtime.lastError);
                    } else {
                        resolve(tabs);
                    }
                });
            });
            
            if (!tabList || tabList.length === 0) {
                throw new Error('未找到活动标签页');
            }
            
            const tab = tabList[0];
            
            // 检查是否是支持的协议
            if (!tab.url.startsWith('http:') && !tab.url.startsWith('https:')) {
                showErrorState('当前页面不支持脚本扫描');
                return;
            }
            
            const response = await new Promise((resolve, reject) => {
                tabs.sendMessage(tab.id, {action: "scanScripts"}, (response) => {
                    if (runtime.runtime.lastError) {
                        reject(runtime.runtime.lastError);
                    } else {
                        resolve(response);
                    }
                });
            });
            
            if (response && response.scripts) {
                currentScripts = response.scripts;
                displayResults(response.scripts);
                updateLastScanTime();
                
                if (analysisResults.length > 0) {
                    displayAnalysisResults(analysisResults);
                }
            } else {
                throw new Error('无法获取脚本信息');
            }
            
        } catch (error) {
            showErrorState('扫描失败: ' + error.message);
        }
    }

    // 仿冒网站上报 - 通过background script发送
    async function reportFakeWebsite() {
        try {
            // 重新获取当前标签页信息，确保数据最新
            await getCurrentTabInfo();
            
            if (!currentTabInfo.url) {
                throw new Error('无法获取当前页面URL');
            }

            if (!currentTabInfo.title) {
                throw new Error('无法获取页面标题');
            }

            // 验证URL格式
            try {
                new URL(currentTabInfo.url);
            } catch (e) {
                throw new Error('当前页面URL格式无效');
            }

            // 显示上报中状态
            setReportButtonState('loading');

            // 准备上报数据
            const reportData = {
                url: currentTabInfo.url,
                title: currentTabInfo.title,
                timestamp: new Date().toISOString(),
                reporter: 'browser_extension_v1.1.0'
            };

            // 通过background script发送请求
            const response = await new Promise((resolve, reject) => {
                runtime.runtime.sendMessage({
                    action: "reportFakeWebsite",
                    data: reportData
                }, (response) => {
                    if (runtime.runtime.lastError) {
                        reject(new Error(runtime.runtime.lastError.message));
                        return;
                    }
                    
                    if (response && response.success) {
                        resolve(response);
                    } else {
                        reject(new Error(response?.error || '上报失败'));
                    }
                });
            });

            showMessage(`仿冒网站上报成功: ${response.message || '上报成功'}`, 'success');

        } catch (error) {
            let errorMessage = '上报失败';
            
            if (error.message.includes('NetworkError') || error.message.includes('Failed to fetch')) {
                errorMessage = '网络连接失败，请检查网络连接';
            } else if (error.message.includes('CORS') || error.message.includes('cross-origin')) {
                errorMessage = '跨域请求被阻止';
            } else if (error.message.includes('certificate') || error.message.includes('SSL')) {
                errorMessage = '证书验证失败';
            } else if (error.message.includes('timeout')) {
                errorMessage = '请求超时';
            } else {
                errorMessage = error.message || '未知错误';
            }
            
            showMessage(`仿冒网站上报失败: ${errorMessage}`, 'error');
        } finally {
            // 恢复按钮状态
            setReportButtonState('normal');
        }
    }

    // 设置上报按钮状态
    function setReportButtonState(state) {
        switch(state) {
            case 'loading':
                reportBtn.disabled = true;
                reportBtn.textContent = '';
                
                // 创建 spinner 图标
                const spinner = document.createElement('i');
                spinner.className = 'fas fa-spinner fa-spin';
                
                const text = document.createTextNode(' 上报中...');
                
                reportBtn.appendChild(spinner);
                reportBtn.appendChild(text);
                reportBtn.style.opacity = '0.7';
                break;
            case 'normal':
            default:
                reportBtn.disabled = false;
                reportBtn.textContent = '';
                
                const flagIcon = document.createElement('i');
                flagIcon.className = 'fas fa-flag';
                
                const normalText = document.createTextNode(' 仿冒上报');
                
                reportBtn.appendChild(flagIcon);
                reportBtn.appendChild(normalText);
                reportBtn.style.opacity = '1';
                break;
        }
    }

    function setScanningState() {
        statusElement.className = 'status scanning';
        
        // 清空状态图标并重新创建
        const statusIcon = statusElement.querySelector('.status-icon');
        statusIcon.textContent = '';
        const spinnerIcon = document.createElement('i');
        spinnerIcon.className = 'fas fa-spinner fa-spin';
        statusIcon.appendChild(spinnerIcon);
        
        const statusTitle = statusElement.querySelector('.status-title');
        statusTitle.textContent = '扫描中...';
        statusDescElement.textContent = '正在分析页面脚本';
        
        // 清空脚本列表并重新创建
        scriptsListElement.textContent = '';
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        
        const spinner = document.createElement('i');
        spinner.className = 'fas fa-spinner fa-spin';
        
        const text = document.createElement('p');
        text.textContent = '正在扫描页面...';
        
        emptyState.appendChild(spinner);
        emptyState.appendChild(text);
        scriptsListElement.appendChild(emptyState);
    }

    function showErrorState(message) {
        statusElement.className = 'status danger';
        
        const statusIcon = statusElement.querySelector('.status-icon');
        statusIcon.textContent = '';
        const warningIcon = document.createElement('i');
        warningIcon.className = 'fas fa-exclamation-circle';
        statusIcon.appendChild(warningIcon);
        
        const statusTitle = statusElement.querySelector('.status-title');
        statusTitle.textContent = '扫描失败';
        statusDescElement.textContent = message || '无法获取页面脚本信息';
        
        scriptsListElement.textContent = '';
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        
        const warning = document.createElement('i');
        warning.className = 'fas fa-exclamation-triangle';
        
        const text1 = document.createElement('p');
        text1.textContent = '无法扫描当前页面';
        
        const text2 = document.createElement('p');
        text2.textContent = message || '请刷新页面后重试';
        text2.style.fontSize = '11px';
        text2.style.marginTop = '5px';
        
        emptyState.appendChild(warning);
        emptyState.appendChild(text1);
        emptyState.appendChild(text2);
        scriptsListElement.appendChild(emptyState);
    }

    function displayResults(scripts) {
        // 获取白名单
        storage.sync.get(['whitelist'], function(result) {
            const whitelist = result.whitelist || [];
            
            // 分类脚本
            const internalScripts = scripts.filter(s => s.type === 'internal');
            const externalScripts = scripts.filter(s => s.type === 'external');
            const trustedScripts = externalScripts.filter(s => 
                whitelist.some(domain => s.src.includes(domain))
            );
            const untrustedScripts = externalScripts.filter(s => 
                !whitelist.some(domain => s.src.includes(domain))
            );

            // 更新状态
            updateStatus(internalScripts, untrustedScripts, trustedScripts);
            
            // 显示脚本列表
            if (scripts.length === 0) {
                scriptsListElement.textContent = '';
                const emptyState = document.createElement('div');
                emptyState.className = 'empty-state';
                
                const icon = document.createElement('i');
                icon.className = 'fas fa-info-circle';
                
                const text = document.createElement('p');
                text.textContent = '未检测到脚本引用';
                
                emptyState.appendChild(icon);
                emptyState.appendChild(text);
                scriptsListElement.appendChild(emptyState);
                return;
            }

            scriptsListElement.textContent = '';
            
            // 内部脚本
            if (internalScripts.length > 0) {
                const section = createScriptSection('内部脚本', internalScripts, 'internal');
                scriptsListElement.appendChild(section);
            }
            
            // 可信外部脚本
            if (trustedScripts.length > 0) {
                const section = createScriptSection('可信外部脚本', trustedScripts, 'trusted');
                scriptsListElement.appendChild(section);
            }
            
            // 不可信外部脚本
            if (untrustedScripts.length > 0) {
                const section = createScriptSection('外部脚本', untrustedScripts, 'external');
                scriptsListElement.appendChild(section);
            }
        });
    }

    // 辅助函数：创建脚本部分
    function createScriptSection(title, scripts, type) {
        const section = document.createElement('div');
        section.className = 'script-section';
        
        const titleDiv = document.createElement('div');
        titleDiv.className = 'section-title';
        titleDiv.textContent = title;
        section.appendChild(titleDiv);
        
        scripts.forEach(script => {
            const scriptItem = createScriptItem(script, type);
            section.appendChild(scriptItem);
        });
        
        return section;
    }

    // 辅助函数：创建脚本项
    function createScriptItem(script, type) {
        const domain = extractDomain(script.src);
        let typeText = '';
        let icon = '';
        
        switch(type) {
            case 'internal':
                typeText = '内部脚本';
                icon = 'fa-check';
                break;
            case 'trusted':
                typeText = '可信外部脚本';
                icon = 'fa-shield-alt';
                break;
            case 'external':
                typeText = '外部脚本';
                icon = 'fa-external-link-alt';
                break;
        }
        
        const itemDiv = document.createElement('div');
        itemDiv.className = `script-item ${type}`;
        
        const iconDiv = document.createElement('div');
        iconDiv.className = 'script-icon';
        const iconElement = document.createElement('i');
        iconElement.className = `fas ${icon}`;
        iconDiv.appendChild(iconElement);
        
        const infoDiv = document.createElement('div');
        infoDiv.className = 'script-info';
        
        const srcDiv = document.createElement('div');
        srcDiv.className = 'script-src';
        srcDiv.textContent = script.src;
        
        const typeDiv = document.createElement('div');
        typeDiv.className = 'script-type';
        typeDiv.textContent = `${typeText} - ${domain}`;
        
        infoDiv.appendChild(srcDiv);
        infoDiv.appendChild(typeDiv);
        
        itemDiv.appendChild(iconDiv);
        itemDiv.appendChild(infoDiv);
        
        return itemDiv;
    }

    function updateStatus(internal, untrusted, trusted) {
        const totalExternal = untrusted.length + trusted.length;
        
        if (totalExternal === 0) {
            statusElement.className = 'status safe';
            const statusIcon = statusElement.querySelector('.status-icon');
            statusIcon.textContent = '';
            const checkIcon = document.createElement('i');
            checkIcon.className = 'fas fa-check';
            statusIcon.appendChild(checkIcon);
            
            const statusTitle = statusElement.querySelector('.status-title');
            statusTitle.textContent = '安全';
            statusDescElement.textContent = '未检测到外部脚本';
        } else if (untrusted.length === 0) {
            statusElement.className = 'status safe';
            const statusIcon = statusElement.querySelector('.status-icon');
            statusIcon.textContent = '';
            const checkIcon = document.createElement('i');
            checkIcon.className = 'fas fa-check';
            statusIcon.appendChild(checkIcon);
            
            const statusTitle = statusElement.querySelector('.status-title');
            statusTitle.textContent = '安全';
            statusDescElement.textContent = `检测到 ${totalExternal} 个可信外部脚本`;
        } else {
            statusElement.className = 'status warning';
            const statusIcon = statusElement.querySelector('.status-icon');
            statusIcon.textContent = '';
            const warningIcon = document.createElement('i');
            warningIcon.className = 'fas fa-exclamation-triangle';
            statusIcon.appendChild(warningIcon);
            
            const statusTitle = statusElement.querySelector('.status-title');
            statusTitle.textContent = '注意';
            statusDescElement.textContent = `检测到 ${untrusted.length} 个外部脚本`;
        }
    }

    function extractDomain(url) {
        try {
            const domain = new URL(url).hostname;
            return domain.replace(/^www\./, '');
        } catch (e) {
            return url;
        }
    }

    function updateLastScanTime() {
        const now = new Date();
        lastScanElement.textContent = `最后扫描: ${now.toLocaleTimeString()}`;
    }

    function displayAnalysisResults(analysisData) {
        if (analysisData.results && analysisData.results.length > 0) {
            // 保存当前的脚本列表内容
            const existingSections = Array.from(scriptsListElement.querySelectorAll('.script-section'));
            
            // 清空列表
            scriptsListElement.textContent = '';
            
            // 添加分析结果
            const analysisSection = createAnalysisSection(analysisData);
            scriptsListElement.appendChild(analysisSection);
            
            // 重新添加原有的脚本部分
            existingSections.forEach(section => {
                const clonedSection = cloneScriptSectionSafely(section);
                scriptsListElement.appendChild(clonedSection);
            });
        }
    }

    // 辅助函数：安全克隆脚本部分
    function cloneScriptSectionSafely(section) {
        const newSection = document.createElement('div');
        newSection.className = section.className;
        
        // 克隆标题
        const title = section.querySelector('.section-title');
        if (title) {
            const newTitle = document.createElement('div');
            newTitle.className = 'section-title';
            newTitle.textContent = title.textContent;
            newSection.appendChild(newTitle);
        }
        
        // 克隆脚本项
        const scriptItems = section.querySelectorAll('.script-item');
        scriptItems.forEach(item => {
            const newItem = document.createElement('div');
            newItem.className = item.className;
            
            // 克隆图标
            const icon = item.querySelector('.script-icon');
            if (icon) {
                const newIcon = document.createElement('div');
                newIcon.className = 'script-icon';
                const iconElement = icon.querySelector('i');
                if (iconElement) {
                    const newIconElement = document.createElement('i');
                    newIconElement.className = iconElement.className;
                    newIcon.appendChild(newIconElement);
                }
                newItem.appendChild(newIcon);
            }
            
            // 克隆信息
            const info = item.querySelector('.script-info');
            if (info) {
                const newInfo = document.createElement('div');
                newInfo.className = 'script-info';
                
                const src = info.querySelector('.script-src');
                if (src) {
                    const newSrc = document.createElement('div');
                    newSrc.className = 'script-src';
                    newSrc.textContent = src.textContent;
                    newInfo.appendChild(newSrc);
                }
                
                const type = info.querySelector('.script-type');
                if (type) {
                    const newType = document.createElement('div');
                    newType.className = 'script-type';
                    newType.textContent = type.textContent;
                    newInfo.appendChild(newType);
                }
                
                newItem.appendChild(newInfo);
            }
            
            newSection.appendChild(newItem);
        });
        
        return newSection;
    }

    function createAnalysisSection(analysisData) {
        const section = document.createElement('div');
        section.className = 'script-section analysis-section';
        
        const titleDiv = document.createElement('div');
        titleDiv.className = 'section-title';
        titleDiv.textContent = '分析结果';
        section.appendChild(titleDiv);
        
        analysisData.results.forEach(result => {
            const riskClass = getRiskClass(result.riskLevel);
            const riskIcon = getRiskIcon(result.riskLevel);
            const riskText = getRiskText(result.riskLevel);
            
            const itemDiv = document.createElement('div');
            itemDiv.className = `script-item ${riskClass}`;
            
            const iconDiv = document.createElement('div');
            iconDiv.className = 'script-icon';
            const iconElement = document.createElement('i');
            iconElement.className = `fas ${riskIcon}`;
            iconDiv.appendChild(iconElement);
            
            const infoDiv = document.createElement('div');
            infoDiv.className = 'script-info';
            
            const srcDiv = document.createElement('div');
            srcDiv.className = 'script-src';
            srcDiv.textContent = result.url;
            
            const typeDiv = document.createElement('div');
            typeDiv.className = 'script-type';
            typeDiv.textContent = `${riskText} - ${result.domain}`;
            
            if (result.blocked) {
                const blockedBadge = document.createElement('span');
                blockedBadge.className = 'blocked-badge';
                blockedBadge.textContent = '已阻止';
                typeDiv.appendChild(blockedBadge);
            }
            
            infoDiv.appendChild(srcDiv);
            infoDiv.appendChild(typeDiv);
            
            itemDiv.appendChild(iconDiv);
            itemDiv.appendChild(infoDiv);
            section.appendChild(itemDiv);
        });
        
        return section;
    }

    function getRiskClass(riskLevel) {
        switch(riskLevel) {
            case 'low': return 'safe';
            case 'medium': return 'warning';
            case 'high': return 'danger';
            default: return 'external';
        }
    }

    function getRiskIcon(riskLevel) {
        switch(riskLevel) {
            case 'low': return 'fa-check-circle';
            case 'medium': return 'fa-exclamation-triangle';
            case 'high': return 'fa-skull-crossbones';
            default: return 'fa-question-circle';
        }
    }

    function getRiskText(riskLevel) {
        switch(riskLevel) {
            case 'low': return '低风险';
            case 'medium': return '中风险';
            case 'high': return '高风险';
            default: return '未知风险';
        }
    }

    function showMessage(message, type) {
        // 移除现有消息
        const existingMessages = document.querySelectorAll('.popup-message');
        existingMessages.forEach(msg => {
            if (msg.parentNode) {
                msg.parentNode.removeChild(msg);
            }
        });

        // 创建新消息元素
        const messageElement = document.createElement('div');
        messageElement.className = `popup-message ${type}`;
        messageElement.textContent = message;
        messageElement.style.cssText = `
            position: fixed;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            padding: 12px 20px;
            border-radius: 6px;
            color: white;
            z-index: 10000;
            font-size: 13px;
            font-weight: 500;
            max-width: 350px;
            text-align: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: messageSlideIn 0.3s ease-out;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        `;
        
        // 设置背景颜色
        if (type === 'error') {
            messageElement.style.background = '#f44336';
            messageElement.style.borderLeft = '4px solid #d32f2f';
        } else if (type === 'info') {
            messageElement.style.background = '#2196f3';
            messageElement.style.borderLeft = '4px solid #1976d2';
        } else if (type === 'warning') {
            messageElement.style.background = '#ff9800';
            messageElement.style.borderLeft = '4px solid #f57c00';
        } else {
            messageElement.style.background = '#4caf50';
            messageElement.style.borderLeft = '4px solid #388e3c';
        }
        
        document.body.appendChild(messageElement);
        
        // 添加CSS动画
        if (!document.querySelector('#popup-message-styles')) {
            const style = document.createElement('style');
            style.id = 'popup-message-styles';
            style.textContent = `
                @keyframes messageSlideIn {
                    from { 
                        transform: translateX(-50%) translateY(-20px); 
                        opacity: 0; 
                    }
                    to { 
                        transform: translateX(-50%) translateY(0); 
                        opacity: 1; 
                    }
                }
                @keyframes messageSlideOut {
                    from { 
                        transform: translateX(-50%) translateY(0); 
                        opacity: 1; 
                    }
                    to { 
                        transform: translateX(-50%) translateY(-20px); 
                        opacity: 0; 
                    }
                }
            `;
            document.head.appendChild(style);
        }
        
        // 5秒后自动消失
        setTimeout(() => {
            if (messageElement.parentNode) {
                messageElement.style.animation = 'messageSlideOut 0.3s ease-in';
                setTimeout(() => {
                    if (messageElement.parentNode) {
                        messageElement.parentNode.removeChild(messageElement);
                    }
                }, 300);
            }
        }, 5000);
        
        // 点击关闭
        messageElement.addEventListener('click', () => {
            if (messageElement.parentNode) {
                messageElement.parentNode.removeChild(messageElement);
            }
        });
    }

    // 添加CSS动画
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
        .script-section {
            margin-bottom: 15px;
        }
        .script-section .section-title {
            background: #f0f0f0;
            color: #333;
            padding: 5px 10px;
            font-size: 11px;
            font-weight: bold;
            margin-bottom: 5px;
            border-radius: 3px;
        }
        .risk-badge {
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: bold;
            color: white;
        }
        .risk-badge.safe {
            background: #4caf50;
        }
        .risk-badge.warning {
            background: #ff9800;
        }
        .risk-badge.danger {
            background: #f44336;
        }
        .risk-badge.external {
            background: #9e9e9e;
        }
        
        .blocked-warning {
            background: #ffebee;
            border: 1px solid #f44336;
            border-radius: 6px;
            padding: 10px;
            margin: 10px 0;
            text-align: center;
            color: #d32f2f;
            font-weight: bold;
        }
        
        .blocked-warning i {
            margin-right: 8px;
            color: #f44336;
        }
        
        .script-item.blocked {
            background: #fff8e1;
            border-left: 4px solid #ff9800;
        }
        
        .blocked-badge {
            background: #f44336;
            color: white;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: bold;
            margin-left: 8px;
        }
        
        /* 上报按钮禁用状态 */
        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        
        .analysis-section {
            border-bottom: 2px solid #6a11cb;
            margin-bottom: 10px;
        }
        
        .analysis-section .section-title {
            background: #6a11cb;
            color: white;
            padding: 8px 15px;
            font-size: 12px;
            font-weight: bold;
            border-radius: 4px 4px 0 0;
        }
    `;
    document.head.appendChild(style);

    // 监听来自content script的分析结果
    runtime.runtime.onMessage.addListener(function(request, sender, sendResponse) {
      
        if (request.action === "analysisResult") {
            analysisResults = request.data;
            displayAnalysisResults(request.data);
            sendResponse({success: true});
        } else if (request.action === "serviceStatusUpdate") {
            updateServiceStatus(request.available);
            sendResponse({success: true});
        }
        return true;
    });

    // 检查服务状态
    function checkServiceHealth() {
        fetch('http://127.0.0.1:8500/health')
            .then(response => {
                if (response.ok) {
                    updateServiceStatus(true);
                    storage.sync.set({serviceAvailable: true});
                } else {
                    throw new Error('Service not healthy');
                }
            })
            .catch(error => {
                updateServiceStatus(false);
                storage.sync.set({serviceAvailable: false});
            });
    }

    // 全局函数供HTML调用
    window.scanPage = scanPage;
});