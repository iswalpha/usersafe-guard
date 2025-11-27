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
        chrome.runtime.openOptionsPage();
    });

    // 自动发送开关
    autoSendToggle.addEventListener('change', function() {
        chrome.storage.sync.set({autoSend: this.checked});
        showMessage(`自动分析已${this.checked ? '开启' : '关闭'}`, 'info');
    });

    async function init() {
        // 获取当前标签页信息
        await getCurrentTabInfo();
        
        // 加载设置
        const result = await chrome.storage.sync.get(['autoSend', 'serviceAvailable', 'serviceUrl']);
        autoSendToggle.checked = result.autoSend !== false; // 默认开启
        
        // 显示服务状态
        updateServiceStatus(result.serviceAvailable);
        
        // 显示服务URL
        if (serviceStatusElement) {
            const serviceUrl = result.serviceUrl || 'http://127.0.0.1:8500/checkurl';
            serviceStatusElement.setAttribute('title', `服务地址: ${serviceUrl}`);
        }
        
        // 开始扫描
        scanPage();
    }

    // 获取当前标签页信息
    async function getCurrentTabInfo() {
        return new Promise((resolve, reject) => {
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                if (chrome.runtime.lastError) {
                    console.error('获取标签页信息失败:', chrome.runtime.lastError);
                    reject(chrome.runtime.lastError);
                    return;
                }
                
                if (tabs && tabs.length > 0) {
                    currentTabInfo.url = tabs[0].url || '';
                    currentTabInfo.title = tabs[0].title || '';
                    console.log('获取到标签页信息:', currentTabInfo);
                    resolve(currentTabInfo);
                } else {
                    const error = new Error('未找到活动标签页');
                    console.error(error);
                    reject(error);
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

    // 扫描页面
    function scanPage() {
        setScanningState();
        
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (chrome.runtime.lastError) {
                console.error('查询标签页失败:', chrome.runtime.lastError);
                showErrorState('无法访问当前标签页');
                return;
            }
            
            if (tabs && tabs.length > 0) {
                chrome.tabs.sendMessage(tabs[0].id, {action: "scanScripts"}, function(response) {
                    if (chrome.runtime.lastError) {
                        console.error('发送消息失败:', chrome.runtime.lastError);
                        showErrorState('内容脚本未就绪');
                        return;
                    }
                    
                    if (response && response.scripts) {
                        currentScripts = response.scripts;
                        displayResults(response.scripts);
                        updateLastScanTime();
                        
                        // 如果有分析结果，也显示出来
                        if (analysisResults.length > 0) {
                            displayAnalysisResults(analysisResults);
                        }
                    } else {
                        showErrorState('无法获取脚本信息');
                    }
                });
            } else {
                showErrorState('未找到活动标签页');
            }
        });
    }

    // 仿冒网站上报
    async function reportFakeWebsite() {
        console.log('开始仿冒网站上报流程...');
        
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

            console.log('准备上报数据:', reportData);

            // 设置超时
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

            const response = await fetch('http://usg.usersafe.cn/fake.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(reportData),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            console.log('服务器响应状态:', response.status, response.statusText);

            if (!response.ok) {
                let errorMessage = `服务器错误: ${response.status}`;
                try {
                    const errorText = await response.text();
                    if (errorText) {
                        errorMessage += ` - ${errorText}`;
                    }
                } catch (e) {
                    // 忽略解析错误
                }
                throw new Error(errorMessage);
            }

            // 尝试解析响应
            let resultText = '上报成功';
            try {
                const result = await response.json();
                console.log('服务器响应数据:', result);
                if (result.message) {
                    resultText = result.message;
                }
            } catch (e) {
                // 如果不是JSON格式，尝试读取文本
                resultText = await response.text();
                console.log('服务器响应文本:', resultText);
            }

            showMessage(`仿冒网站上报成功: ${resultText}`, 'success');
            console.log('仿冒网站上报成功');

        } catch (error) {
            console.error('仿冒网站上报失败:', error);
            
            let errorMessage = '上报失败';
            
            if (error.name === 'AbortError') {
                errorMessage = '请求超时，请检查网络连接';
            } else if (error.message.includes('Failed to fetch')) {
                errorMessage = '网络连接失败，请检查网络设置';
            } else if (error.message.includes('server error') || error.message.includes('Server error')) {
                errorMessage = '服务器错误，请稍后重试';
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
                reportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 上报中...';
                reportBtn.style.opacity = '0.7';
                break;
            case 'normal':
            default:
                reportBtn.disabled = false;
                reportBtn.innerHTML = '<i class="fas fa-flag"></i> 仿冒上报';
                reportBtn.style.opacity = '1';
                break;
        }
    }

    function setScanningState() {
        statusElement.className = 'status scanning';
        statusElement.querySelector('.status-icon').innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        statusElement.querySelector('.status-title').textContent = '扫描中...';
        statusDescElement.textContent = '正在分析页面脚本';
        
        scriptsListElement.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-spinner fa-spin"></i>
                <p>正在扫描页面...</p>
            </div>
        `;
    }

    function showErrorState(message) {
        statusElement.className = 'status danger';
        statusElement.querySelector('.status-icon').innerHTML = '<i class="fas fa-exclamation-circle"></i>';
        statusElement.querySelector('.status-title').textContent = '扫描失败';
        statusDescElement.textContent = message || '无法获取页面脚本信息';
        
        scriptsListElement.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-triangle"></i>
                <p>无法扫描当前页面</p>
                <p style="font-size: 11px; margin-top: 5px;">${message || '请刷新页面后重试'}</p>
            </div>
        `;
    }

    function displayResults(scripts) {
        // 获取白名单
        chrome.storage.sync.get(['whitelist'], function(result) {
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
                scriptsListElement.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-info-circle"></i>
                        <p>未检测到脚本引用</p>
                    </div>
                `;
                return;
            }

            let html = '';
            
            // 内部脚本
            if (internalScripts.length > 0) {
                html += '<div class="script-section"><div class="section-title">内部脚本</div>';
                internalScripts.forEach(script => {
                    html += createScriptItem(script, 'internal');
                });
                html += '</div>';
            }
            
            // 可信外部脚本
            if (trustedScripts.length > 0) {
                html += '<div class="script-section"><div class="section-title">可信外部脚本</div>';
                trustedScripts.forEach(script => {
                    html += createScriptItem(script, 'trusted');
                });
                html += '</div>';
            }
            
            // 不可信外部脚本
            if (untrustedScripts.length > 0) {
                html += '<div class="script-section"><div class="section-title">外部脚本</div>';
                untrustedScripts.forEach(script => {
                    html += createScriptItem(script, 'external');
                });
                html += '</div>';
            }
            
            scriptsListElement.innerHTML = html;
        });
    }

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
        
        return `
            <div class="script-item ${type}">
                <div class="script-icon">
                    <i class="fas ${icon}"></i>
                </div>
                <div class="script-info">
                    <div class="script-src">${script.src}</div>
                    <div class="script-type">
                        ${typeText} - ${domain}
                    </div>
                </div>
            </div>
        `;
    }

    function updateStatus(internal, untrusted, trusted) {
        const totalExternal = untrusted.length + trusted.length;
        
        if (totalExternal === 0) {
            statusElement.className = 'status safe';
            statusElement.querySelector('.status-icon').innerHTML = '<i class="fas fa-check"></i>';
            statusElement.querySelector('.status-title').textContent = '安全';
            statusDescElement.textContent = '未检测到外部脚本';
        } else if (untrusted.length === 0) {
            statusElement.className = 'status safe';
            statusElement.querySelector('.status-icon').innerHTML = '<i class="fas fa-check"></i>';
            statusElement.querySelector('.status-title').textContent = '安全';
            statusDescElement.textContent = `检测到 ${totalExternal} 个可信外部脚本`;
        } else {
            statusElement.className = 'status warning';
            statusElement.querySelector('.status-icon').innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
            statusElement.querySelector('.status-title').textContent = '注意';
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
            let html = '<div class="analysis-section"><div class="section-title">自动分析结果</div>';
            
            analysisData.results.forEach(result => {
                const riskLevel = result.riskLevel || 'unknown';
                const riskClass = getRiskClass(riskLevel);
                const riskIcon = getRiskIcon(riskLevel);
                
                html += `
                    <div class="script-item ${riskClass}">
                        <div class="script-icon">
                            <i class="fas ${riskIcon}"></i>
                        </div>
                        <div class="script-info">
                            <div class="script-src">${result.url}</div>
                            <div class="script-type">
                                <span class="risk-badge ${riskClass}">${getRiskText(riskLevel)}</span>
                                ${result.reason ? ` - ${result.reason}` : ''}
                                ${result.score ? ` (分数: ${result.score})` : ''}
                            </div>
                        </div>
                    </div>
                `;
            });
            
            html += '</div>';
            
            // 将分析结果插入到脚本列表前面
            const existingContent = scriptsListElement.innerHTML;
            scriptsListElement.innerHTML = html + existingContent;
        }
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
        console.log(`显示消息: ${message}, 类型: ${type}`);
        
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
        
        /* 上报按钮禁用状态 */
        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
    `;
    document.head.appendChild(style);

    // 监听来自content script的分析结果
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        if (request.action === "analysisResult") {
            analysisResults = request.data;
            displayAnalysisResults(request.data);
        } else if (request.action === "serviceStatusUpdate") {
            updateServiceStatus(request.available);
        }
    });

    // 检查服务状态
    checkServiceHealth();

    function checkServiceHealth() {
        fetch('http://127.0.0.1:8500/health')
            .then(response => {
                if (response.ok) {
                    updateServiceStatus(true);
                    chrome.storage.sync.set({serviceAvailable: true});
                } else {
                    throw new Error('Service not healthy');
                }
            })
            .catch(error => {
                updateServiceStatus(false);
                chrome.storage.sync.set({serviceAvailable: false});
            });
    }

    // 全局函数供HTML调用
    window.scanPage = scanPage;
});
