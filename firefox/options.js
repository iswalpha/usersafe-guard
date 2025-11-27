// Firefox 兼容性
const isFirefox = typeof browser !== 'undefined';
const runtime = isFirefox ? browser : chrome;
const storage = isFirefox ? browser.storage : chrome.storage;

document.addEventListener('DOMContentLoaded', function() {
    const domainInput = document.getElementById('domainInput');
    const addDomainBtn = document.getElementById('addDomainBtn');
    const whitelistElement = document.getElementById('whitelist');
    const resetBtn = document.getElementById('resetBtn');
    const saveBtn = document.getElementById('saveBtn');
    const autoAnalysisToggle = document.getElementById('autoAnalysisToggle');
    const serviceUrlInput = document.getElementById('serviceUrlInput');
    const updateServiceUrlBtn = document.getElementById('updateServiceUrlBtn');
    const exportBtn = document.getElementById('exportBtn');
    const importBtn = document.getElementById('importBtn');

    let whitelist = [];

    // 初始化
    init();

    // 添加域名按钮
    addDomainBtn.addEventListener('click', addDomain);
    
    // 回车键添加域名
    domainInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            addDomain();
        }
    });

    // 恢复默认白名单
    resetBtn.addEventListener('click', resetToDefault);

    // 保存设置
    saveBtn.addEventListener('click', saveSettings);

    // 自动分析开关
    autoAnalysisToggle.addEventListener('change', function() {
        showMessage(`自动分析已${this.checked ? '开启' : '关闭'}`, 'info');
    });

    // 更新服务URL
    updateServiceUrlBtn.addEventListener('click', updateServiceUrl);

    // 导出设置
    exportBtn.addEventListener('click', exportSettings);

    // 导入设置
    importBtn.addEventListener('click', importSettings);

    async function init() {
        await loadSettings();
        renderWhitelist();
        checkServiceStatus();
    }

    function loadSettings() {
        return new Promise((resolve) => {
            storage.sync.get(['whitelist', 'autoSend', 'serviceUrl'], function(result) {
                whitelist = result.whitelist || getDefaultWhitelist();
                autoAnalysisToggle.checked = result.autoSend !== false;
                serviceUrlInput.value = result.serviceUrl || 'http://127.0.0.1:8500/checkurl';
                resolve();
            });
        });
    }

    function getDefaultWhitelist() {
        return [
            'google.com',
            'googleapis.com',
            'gstatic.com',
            'facebook.com',
            'facebook.net',
            'twitter.com',
            'twimg.com',
            'youtube.com',
            'ytimg.com',
            'cloudflare.com',
            'jquery.com',
            'bootstrapcdn.com',
            'unpkg.com',
            'npmjs.com',
            'github.com',
            'githubusercontent.com'
        ];
    }

    function addDomain() {
        const domain = domainInput.value.trim().toLowerCase();
        
        if (!domain) {
            showMessage('请输入域名', 'error');
            return;
        }

        // 简单的域名验证
        if (!isValidDomain(domain)) {
            showMessage('请输入有效的域名', 'error');
            return;
        }

        if (whitelist.includes(domain)) {
            showMessage('该域名已在白名单中', 'warning');
            return;
        }

        whitelist.push(domain);
        domainInput.value = '';
        renderWhitelist();
        showMessage('域名已添加到白名单', 'success');
    }

    function isValidDomain(domain) {
        // 简单的域名验证
        const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
        return domainRegex.test(domain) && domain.length > 0 && domain.length < 253;
    }

    function removeDomain(domain) {
        whitelist = whitelist.filter(item => item !== domain);
        renderWhitelist();
        showMessage('域名已从白名单移除', 'success');
    }

    function renderWhitelist() {
        if (whitelist.length === 0) {
            // 使用 textContent 替代 innerHTML
            whitelistElement.textContent = '';
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'empty-whitelist';
            
            const icon = document.createElement('i');
            icon.className = 'fas fa-inbox';
            
            const text = document.createElement('p');
            text.textContent = '白名单为空';
            
            emptyDiv.appendChild(icon);
            emptyDiv.appendChild(text);
            whitelistElement.appendChild(emptyDiv);
            return;
        }

        // 清空现有内容
        whitelistElement.textContent = '';
        
        whitelist.forEach(domain => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'whitelist-item';
            
            const domainSpan = document.createElement('span');
            domainSpan.className = 'whitelist-domain';
            domainSpan.textContent = domain;
            
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-btn';
            removeBtn.setAttribute('data-domain', domain);
            
            const removeIcon = document.createElement('i');
            removeIcon.className = 'fas fa-times';
            removeBtn.appendChild(removeIcon);
            
            removeBtn.addEventListener('click', function() {
                const domain = this.getAttribute('data-domain');
                removeDomain(domain);
            });
            
            itemDiv.appendChild(domainSpan);
            itemDiv.appendChild(removeBtn);
            whitelistElement.appendChild(itemDiv);
        });
    }

    function resetToDefault() {
        if (confirm('确定要恢复默认白名单吗？这将移除您添加的所有自定义域名。')) {
            whitelist = getDefaultWhitelist();
            renderWhitelist();
            showMessage('已恢复默认白名单', 'success');
        }
    }

    function saveSettings() {
        const settings = {
            whitelist: whitelist,
            autoSend: autoAnalysisToggle.checked,
            serviceUrl: serviceUrlInput.value.trim()
        };

        storage.sync.set(settings, function() {
            showMessage('设置已保存', 'success');
            // 通知其他页面设置已更新
            runtime.runtime.sendMessage({action: "settingsUpdated"});
        });
    }

    function updateServiceUrl() {
        const url = serviceUrlInput.value.trim();
        if (!url) {
            showMessage('请输入服务URL', 'error');
            return;
        }

        try {
            new URL(url);
            showMessage('服务URL已更新', 'success');
            saveSettings();
        } catch (e) {
            showMessage('请输入有效的URL', 'error');
        }
    }

    function exportSettings() {
        const settings = {
            whitelist: whitelist,
            autoSend: autoAnalysisToggle.checked,
            serviceUrl: serviceUrlInput.value.trim(),
            exportDate: new Date().toISOString(),
            version: '1.1.0'
        };

        const dataStr = JSON.stringify(settings, null, 2);
        const dataBlob = new Blob([dataStr], {type: 'application/json'});
        
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'usersafe-guard-settings.json';
        
        // 使用 textContent 替代 innerHTML
        link.textContent = '下载设置文件';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        URL.revokeObjectURL(url);
        showMessage('设置已导出', 'success');
    }

    function importSettings() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        
        input.onchange = function(e) {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const settings = JSON.parse(e.target.result);
                    
                    // 验证导入的数据
                    if (!settings.whitelist || !Array.isArray(settings.whitelist)) {
                        throw new Error('无效的设置文件');
                    }

                    if (confirm('确定要导入设置吗？这将覆盖当前的所有设置。')) {
                        whitelist = settings.whitelist;
                        autoAnalysisToggle.checked = settings.autoSend !== false;
                        serviceUrlInput.value = settings.serviceUrl || 'http://127.0.0.1:8500/checkurl';
                        
                        renderWhitelist();
                        showMessage('设置已导入', 'success');
                    }
                } catch (error) {
                    showMessage('导入失败：文件格式无效', 'error');
                }
            };
            
            reader.readAsText(file);
        };
        
        input.click();
    }

    function checkServiceStatus() {
        const serviceUrl = serviceUrlInput.value.trim() || 'http://127.0.0.1:8500/checkurl';
        const healthUrl = serviceUrl.replace('/checkurl', '/health');
        
        fetch(healthUrl)
            .then(response => {
                if (response.ok) {
                    showServiceStatus('connected', '服务连接正常');
                } else {
                    throw new Error('Service not healthy');
                }
            })
            .catch(error => {
                showServiceStatus('disconnected', '服务连接失败');
            });
    }

    function showServiceStatus(status, message) {
        // 移除现有状态指示器
        const existingStatus = document.querySelector('.service-status');
        if (existingStatus) {
            existingStatus.remove();
        }

        const statusElement = document.createElement('div');
        statusElement.className = `service-status ${status}`;
        
        const icon = document.createElement('i');
        icon.className = `fas ${status === 'connected' ? 'fa-check-circle' : 'fa-exclamation-circle'}`;
        
        const textSpan = document.createElement('span');
        textSpan.style.marginLeft = '8px';
        textSpan.textContent = message;
        
        statusElement.appendChild(icon);
        statusElement.appendChild(textSpan);

        const serviceSection = document.querySelector('.section:nth-child(4)');
        serviceSection.appendChild(statusElement);
    }

    function showMessage(message, type) {
        // 移除现有消息
        const existingMessages = document.querySelectorAll('.status-message');
        existingMessages.forEach(msg => msg.remove());

        const messageElement = document.createElement('div');
        messageElement.className = `status-message ${type}`;
        messageElement.textContent = message;
        
        // 插入到容器顶部
        const container = document.querySelector('.container');
        container.insertBefore(messageElement, container.firstChild);

        // 3秒后自动消失
        setTimeout(() => {
            if (messageElement.parentNode) {
                messageElement.parentNode.removeChild(messageElement);
            }
        }, 3000);
    }
});