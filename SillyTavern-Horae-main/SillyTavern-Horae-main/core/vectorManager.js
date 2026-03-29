/**
 * Horae - Trình quản lý ký ức Vector
 * Hệ thống truy xuất vector cục bộ dựa trên Transformers.js
 *
 * Dữ liệu được cô lập theo chatId, vector lưu trong IndexedDB, chỉ mục gọn nhẹ lưu ở chat[0].horae_meta.vectorIndex
 */

import { calculateDetailedRelativeTime } from '../utils/timeUtils.js';

const DB_NAME = 'HoraeVectors';
const DB_VERSION = 1;
const STORE_NAME = 'vectors';

const MODEL_CONFIG = {
    'Xenova/bge-small-zh-v1.5': { dimensions: 512, prefix: null },
    'Xenova/multilingual-e5-small': { dimensions: 384, prefix: { query: 'query: ', passage: 'passage: ' } },
};

const TERM_CATEGORIES = {
    medical: ['Băng bó', 'vết thương', 'điều trị', 'cứu chữa', 'xử lý vết thương', 'chữa thương', 'đắp thuốc', 'bôi thuốc', 'bị thương', 'chịu thương', 'chăm sóc', 'hộ lý', 'sơ cứu', 'cầm máu', 'băng vải', 'khâu vết thương', 'tháo giáp', 'tĩnh dưỡng', 'trúng độc', 'giải độc', 'hôn mê', 'tỉnh lại'],
    combat: ['đánh nhau', 'ẩu đả', 'chiến đấu', 'xung đột', 'giao thủ', 'tấn công', 'đánh bại', 'chém giết', 'đối đầu', 'đánh lộn', 'chém giết nhau', 'chém', 'chẻ', 'đâm', 'mai phục', 'bao vây', 'quyết đấu', 'tỷ võ', 'phòng thủ', 'rút lui', 'bỏ chạy', 'truy kích'],
    cooking: ['nấu cơm', 'nấu nướng', 'nấu', 'xào', 'nướng', 'cho ăn', 'ăn cơm', 'húp cháo', 'bữa ăn', 'món ăn', 'bữa ăn', 'nhà bếp', 'nguyên liệu nấu ăn', 'đồ ăn ngon', 'vào bếp', 'làm bánh'],
    clothing: ['thay đồ', 'thay quần áo', 'mặc đồ', 'cởi đồ', 'quần áo', 'thay trang phục', 'áo choàng tắm', 'nội y', 'váy liền', 'áo sơ mi'],
    emotion_positive: ['vui vẻ', 'vui mừng', 'hạnh phúc', 'vui sướng', 'mừng rỡ', 'sảng khoái', 'thỏa mãn', 'cảm động', 'ấm áp', 'hạnh phúc'],
    emotion_negative: ['tức giận', 'phẫn nộ', 'nổi giận', 'nổi nóng', 'bực tức', 'buồn bã', 'đau lòng', 'bi thương', 'khóc lóc', 'rơi lệ', 'sợ hãi', 'sợ', 'hoảng sợ', 'tủi thân', 'thất vọng', 'lo lắng', 'xấu hổ', 'áy náy', 'suy sụp'],
    movement: ['kéo', 'bưng', 'ôm', 'cõng', 'đỡ', 'khiêng', 'đẩy', 'lôi', 'mang đi', 'di chuyển', 'dìu dắt', 'sắp xếp'],
    social: ['tỏ tình', 'thổ lộ', 'xin lỗi', 'ôm', 'hôn', 'bắt tay', 'lần đầu', 'đoàn tụ', 'cầu hôn', 'đính hôn', 'kết hôn'],
    gift: ['quà tặng', 'tặng', 'tặng cho', 'tín vật', 'định tình', 'nhẫn', 'dây chuyền', 'vòng tay', 'bó hoa', 'sô-cô-la', 'thiệp chúc mừng', 'đồ lưu niệm', 'của hồi môn', 'sính lễ', 'huy hiệu', 'huân chương', 'đá quý', 'nhận lấy', 'tặng lại'],
    ceremony: ['hôn lễ', 'tang lễ', 'nghi thức', 'buổi lễ', 'lễ mừng', 'lễ hội', 'tế lễ', 'lên ngôi', 'sắc phong', 'tuyên thệ', 'lễ rửa tội', 'lễ trưởng thành', 'tốt nghiệp', 'chúc mừng', 'ngày kỷ niệm', 'sinh nhật', 'lễ kỷ niệm', 'lễ hội', 'khai mạc', 'bế mạc', 'tiệc mừng công', 'yến tiệc', 'vũ hội'],
    revelation: ['bí mật', 'sự thật', 'vạch trần', 'thú nhận', 'bại lộ', 'phát hiện', 'thân phận thật sự', 'che giấu', 'lời nói dối', 'lừa gạt', 'ngụy trang', 'mạo danh', 'tên thật', 'huyết thống', 'thân thế', 'nằm vùng', 'gián điệp', 'mật báo', 'vạch trần', 'vạch trần'],
    promise: ['lời hứa', 'lời thề', 'giao ước', 'đảm bảo', 'thề', 'lập lời thề', 'khế ước', 'minh ước', 'hứa hẹn', 'hẹn trước', 'bảo vệ', 'hiệu trung', 'thề ước'],
    loss: ['tử vong', 'qua đời', 'hy sinh', 'chia ly', 'xa cách', 'từ biệt', 'đánh mất', 'biến mất', 'ngã xuống', 'tàn phai', 'vĩnh biệt', 'mất đi', 'tử trận', 'hy sinh vì nhiệm vụ', 'tiễn biệt', 'quyết biệt', 'chết yểu'],
    power: ['thức tỉnh', 'thăng cấp', 'tiến hóa', 'đột phá', 'suy thoái', 'mất đi sức mạnh', 'mở phong ấn', 'phong ấn', 'biến hình', 'biến dị', 'có được sức mạnh', 'ma lực', 'năng lực', 'thiên phú', 'huyết mạch', 'kế thừa', 'truyền thừa', 'tu luyện', 'lĩnh ngộ'],
    intimate: ['thân mật', 'quấn quýt', 'chuyện tình ái', 'đêm xuân', 'hoan ái', 'qua đêm', 'cùng giường', 'tiếp xúc da thịt', 'thân thiết', 'mập mờ', 'trêu chọc', 'quyến rũ', 'dụ dỗ', 'khêu gợi', 've vãn', 'tình động', 'động tình', 'dục vọng', 'khao khát', 'tham luyến', 'đòi hỏi', 'nghênh hợp', 'vướng víu', 'say mê', 'chìm đắm', 'mê mẩn', 'đắm chìm', 'thở dốc', 'run rẩy', 'rên rỉ', 'thở dốc', 'ngân nga', 'xin tha', 'mất kiểm soát', 'nhẫn nhịn', 'kìm nén', 'phóng túng', 'tham lam', 'âu yếm', 'dư âm', 'quấn quýt', 'kiều diễm', 'giao cấu', 'xuất tinh trong', 'xuất tinh lên mặt', 'hành vi tình dục', 'xuất tinh trong', 'xuất tinh', 'cơ quan sinh dục', 'giao phối', 'ân ái vụng trộm', 'hoan ái', 'lên đỉnh'],
    body_contact: ['vuốt ve', 'chạm vào', 'áp sát', 'dựa dẫm', 'ôm ấp', 'hôn', 'cắn mút', 'liếm', 'mút', 'xoa nắn', 'nhào nặn', 'ấn', 'nắm lấy', 'nắm tay', 'mười ngón tay đan nhau', 'trán chạm trán', 'tai chạm mang tai', 'đỏ mặt', 'tim đập', 'cơ thể', 'da thịt', 'xương quai xanh', 'cổ', 'dái tai', 'đôi môi', 'vòng eo', 'lưng', 'mái tóc', 'đầu ngón tay', 'lòng bàn tay'],
};

export class VectorManager {
    constructor() {
        this.worker = null;
        this.db = null;
        this.chatId = null;
        this.vectors = new Map();
        this.isReady = false;
        this.isLoading = false;
        this.isApiMode = false;
        this.dimensions = 0;
        this.modelName = '';
        this._apiUrl = '';
        this._apiKey = '';
        this._apiModel = '';
        this.termCounts = new Map();
        this.totalDocuments = 0;
        this._pendingCallbacks = new Map();
        this._callId = 0;
    }

    // ========================================
    // Vòng đời
    // ========================================

    async initModel(model, dtype, onProgress) {
        if (this.isLoading) return;
        this.isLoading = true;
        this.isReady = false;
        this.modelName = model;

        try {
            await this._disposeWorker();

            const workerUrl = new URL('../utils/embeddingWorker.js', import.meta.url);
            this.worker = new Worker(workerUrl, { type: 'module' });

            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Tải mô hình quá thời gian (5 phút)')), 300000);

                this.worker.onmessage = (e) => {
                    const { type, data, dimensions: dims } = e.data;
                    if (type === 'progress' && onProgress) {
                        onProgress(data);
                    } else if (type === 'ready') {
                        this.dimensions = dims;
                        this.isReady = true;
                        clearTimeout(timeout);
                        resolve();
                    } else if (type === 'error') {
                        clearTimeout(timeout);
                        reject(new Error(e.data.message));
                    } else if (type === 'result' || type === 'disposed') {
                        const cb = this._pendingCallbacks.get(e.data.id);
                        if (cb) {
                            this._pendingCallbacks.delete(e.data.id);
                            cb.resolve(e.data);
                        }
                    }
                };

                this.worker.onerror = (err) => {
                    clearTimeout(timeout);
                    reject(new Error(err.message || 'Worker tải thất bại'));
                };

                this.worker.postMessage({ type: 'init', data: { model, dtype: dtype || 'q8' } });
            });

            this.worker.onmessage = (e) => {
                const msg = e.data;
                if (msg.type === 'result' || msg.type === 'error' || msg.type === 'disposed') {
                    const cb = this._pendingCallbacks.get(msg.id);
                    if (cb) {
                        this._pendingCallbacks.delete(msg.id);
                        if (msg.type === 'error') cb.reject(new Error(msg.message));
                        else cb.resolve(msg);
                    }
                }
            };

            console.log(`[Horae Vector] Mô hình đã tải: ${model} (${this.dimensions} chiều)`);
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Khởi tạo chế độ API (Endpoint embedding tương thích OpenAI)
     */
    async initApi(url, key, model) {
        if (this.isLoading) return;
        this.isLoading = true;
        this.isReady = false;

        try {
            await this._disposeWorker();

            this.isApiMode = true;
            this._apiUrl = url.replace(/\/+$/, '');
            this._apiKey = key;
            this._apiModel = model;
            this.modelName = model;

            // Thăm dò số chiều: Gửi một đoạn văn bản thử nghiệm
            const testResult = await this._embedApi(['test']);
            if (!testResult?.vectors?.[0]) {
                throw new Error('Kết nối API thất bại hoặc định dạng trả về bất thường, vui lòng kiểm tra xem địa chỉ, khóa và tên mô hình đã đúng chưa');
            }
            this.dimensions = testResult.vectors[0].length;
            this.isReady = true;
            console.log(`[Horae Vector] Chế độ API đã sẵn sàng: ${model} (${this.dimensions} chiều)`);
        } finally {
            this.isLoading = false;
        }
    }

    async dispose() {
        await this._disposeWorker();
        this.vectors.clear();
        this.termCounts.clear();
        this.totalDocuments = 0;
        this.chatId = null;
        this.isReady = false;
        this.isApiMode = false;
        this._apiUrl = '';
        this._apiKey = '';
        this._apiModel = '';
    }

    async _disposeWorker() {
        if (this.worker) {
            try {
                this.worker.postMessage({ type: 'dispose' });
                await new Promise(r => setTimeout(r, 200));
            } catch (_) { /* bỏ qua */ }
            this.worker.terminate();
            this.worker = null;
        }
        this._pendingCallbacks.clear();
    }

    /**
     * Chuyển cuộc trò chuyện: Tải chỉ mục vector của chatId tương ứng
     */
    async loadChat(chatId, chat) {
        this.chatId = chatId;
        this.vectors.clear();
        this.termCounts.clear();
        this.totalDocuments = 0;

        if (!chatId) return;

        try {
            await this._openDB();
            const stored = await this._loadAllVectors();
            const staleKeys = [];
            for (const item of stored) {
                if (item.messageIndex >= chat.length) {
                    staleKeys.push(item.messageIndex);
                    continue;
                }
                const doc = this.buildVectorDocument(chat[item.messageIndex]?.horae_meta);
                if (doc && this._hashString(doc) !== item.hash) {
                    staleKeys.push(item.messageIndex);
                    continue;
                }
                this.vectors.set(item.messageIndex, {
                    vector: item.vector,
                    hash: item.hash,
                    document: item.document,
                });
                this._updateTermCounts(item.document, 1);
                this.totalDocuments++;
            }
            if (staleKeys.length > 0) {
                for (const idx of staleKeys) await this._deleteVector(idx);
                console.log(`[Horae Vector] Đã dọn dẹp ${staleKeys.length} vector hết hạn/nằm ngoài nhánh`);
            }
            console.log(`[Horae Vector] Đã tải ${this.vectors.size} vector (chatId: ${chatId})`);
        } catch (err) {
            console.warn('[Horae Vector] Tải chỉ mục vector thất bại:', err);
        }
    }

    // ========================================
    // Xây dựng tài liệu
    // ========================================

    /**
     * Chuyển đổi horae_meta thành văn bản truy xuất
     * Lấy tóm tắt sự kiện làm cốt lõi (Chiếm trọng số chính), bối cảnh/nhân vật/NPC làm phụ
     * Loại bỏ các yếu tố nhiễu như vật phẩm, trang phục, tâm trạng, giúp embedding tập trung vào nội dung chính có ý nghĩa
     */
    buildVectorDocument(meta) {
        if (!meta) return '';

        const eventTexts = [];
        if (meta.events?.length > 0) {
            for (const evt of meta.events) {
                if (evt.isSummary || evt.level === 'Tóm tắt' || evt._summaryId) continue;
                if (evt.summary) eventTexts.push(evt.summary);
            }
        }

        const npcTexts = [];
        if (meta.npcs) {
            for (const [name, info] of Object.entries(meta.npcs)) {
                let s = name;
                if (info.appearance) s += ` ${info.appearance}`;
                if (info.relationship) s += ` ${info.relationship}`;
                npcTexts.push(s);
            }
        }

        if (eventTexts.length === 0 && npcTexts.length === 0) return '';

        const parts = [];

        for (const t of eventTexts) parts.push(t);

        for (const t of npcTexts) parts.push(t);

        if (meta.scene?.location) parts.push(meta.scene.location);

        const chars = meta.scene?.characters_present || [];
        if (chars.length > 0) parts.push(chars.join(' '));

        if (meta.timestamp?.story_date) {
            parts.push(meta.timestamp.story_time
                ? `${meta.timestamp.story_date} ${meta.timestamp.story_time}`
                : meta.timestamp.story_date);
        }

        // Cột mốc RPG: Thay đổi cấp độ, sự kiện trang bị, thay đổi cứ điểm
        const rpg = meta._rpgChanges;
        if (rpg) {
            if (rpg.levels && Object.keys(rpg.levels).length > 0) {
                for (const [owner, lv] of Object.entries(rpg.levels)) {
                    parts.push(`${owner} thăng cấp lên Lv.${lv}`);
                }
            }
            for (const eq of (rpg.equipment || [])) {
                parts.push(`${eq.owner} đã trang bị ${eq.name}(${eq.slot})`);
            }
            for (const u of (rpg.unequip || [])) {
                parts.push(`${u.owner} tháo ${u.name}(${u.slot})`);
            }
            for (const bc of (rpg.baseChanges || [])) {
                if (bc.field === 'level') parts.push(`Cứ điểm ${bc.path} thăng lên Lv.${bc.value}`);
            }
        }

        return parts.join(' | ');
    }

    // ========================================
    // Thao tác chỉ mục
    // ========================================

    async addMessage(messageIndex, meta) {
        if (!this.isReady || !this.chatId) return;
        if (meta?._skipHorae) return;

        const doc = this.buildVectorDocument(meta);
        if (!doc) return;

        const hash = this._hashString(doc);
        const existing = this.vectors.get(messageIndex);
        if (existing && existing.hash === hash) return;

        const text = this._prepareText(doc, false);
        const result = await this._embed([text]);
        if (!result || !result.vectors?.[0]) return;

        const vector = result.vectors[0];

        if (existing) {
            this._updateTermCounts(existing.document, -1);
        } else {
            this.totalDocuments++;
        }

        this.vectors.set(messageIndex, { vector, hash, document: doc });
        this._updateTermCounts(doc, 1);
        await this._saveVector(messageIndex, { vector, hash, document: doc });
    }

    async removeMessage(messageIndex) {
        const existing = this.vectors.get(messageIndex);
        if (!existing) return;

        this._updateTermCounts(existing.document, -1);
        this.totalDocuments--;
        this.vectors.delete(messageIndex);
        await this._deleteVector(messageIndex);
    }

    /**
     * Xây dựng chỉ mục hàng loạt (Dùng cho lịch sử)
     * @returns {{ indexed: number, skipped: number }}
     */
    async batchIndex(chat, onProgress) {
        if (!this.isReady || !this.chatId) return { indexed: 0, skipped: 0 };

        const tasks = [];
        for (let i = 0; i < chat.length; i++) {
            const meta = chat[i].horae_meta;
            if (!meta || chat[i].is_user) continue;
            if (meta._skipHorae) continue;
            const doc = this.buildVectorDocument(meta);
            if (!doc) continue;
            const hash = this._hashString(doc);
            const existing = this.vectors.get(i);
            if (existing && existing.hash === hash) continue;
            tasks.push({ messageIndex: i, document: doc, hash });
        }

        if (tasks.length === 0) return { indexed: 0, skipped: chat.length };

        const batchSize = this.isApiMode ? 8 : 16;
        let indexed = 0;

        for (let b = 0; b < tasks.length; b += batchSize) {
            const batch = tasks.slice(b, b + batchSize);
            const texts = batch.map(t => this._prepareText(t.document, false));
            const result = await this._embed(texts);
            if (!result?.vectors) continue;

            for (let j = 0; j < batch.length; j++) {
                const task = batch[j];
                const vector = result.vectors[j];
                if (!vector) continue;

                const old = this.vectors.get(task.messageIndex);
                if (old) {
                    this._updateTermCounts(old.document, -1);
                } else {
                    this.totalDocuments++;
                }

                this.vectors.set(task.messageIndex, {
                    vector,
                    hash: task.hash,
                    document: task.document,
                });
                this._updateTermCounts(task.document, 1);
                await this._saveVector(task.messageIndex, { vector, hash: task.hash, document: task.document });
                indexed++;
            }

            if (onProgress) {
                onProgress({ current: Math.min(b + batchSize, tasks.length), total: tasks.length });
            }
        }

        return { indexed, skipped: chat.length - tasks.length };
    }

    async clearIndex() {
        this.vectors.clear();
        this.termCounts.clear();
        this.totalDocuments = 0;
        if (this.chatId) await this._clearVectors();
    }

    // ========================================
    // Truy vấn và gọi lại
    // ========================================

    /**
     * Xây dựng văn bản truy vấn trạng thái (Cảnh/Nhân vật/Sự kiện hiện tại)
     */
    buildStateQuery(currentState, lastMeta) {
        const parts = [];

        if (currentState.scene?.location) parts.push(currentState.scene.location);

        const chars = currentState.scene?.characters_present || [];
        for (const c of chars) {
            parts.push(c);
            if (currentState.costumes?.[c]) parts.push(currentState.costumes[c]);
        }

        if (lastMeta?.events?.length > 0) {
            for (const evt of lastMeta.events) {
                if (evt.summary) parts.push(evt.summary);
            }
        }

        return parts.filter(Boolean).join(' ');
    }

    /**
     * Làm sạch tin nhắn người dùng thành văn bản truy vấn
     */
    cleanUserMessage(rawMessage) {
        if (!rawMessage) return '';
        return rawMessage
            .replace(/<[^>]*>/g, '')
            .replace(/[\[\]]/g, '')
            .trim()
            .substring(0, 300);
    }

    /**
     * Truy xuất vector
     * @param {string} queryText
     * @param {number} topK
     * @param {number} threshold
     * @param {Set<number>} excludeIndices - Các chỉ mục tin nhắn cần loại trừ (đã nằm trong ngữ cảnh)
     * @returns {Promise<Array<{messageIndex: number, similarity: number, document: string}>>}
     */
    async search(queryText, topK = 5, threshold = 0.72, excludeIndices = new Set(), pureMode = false) {
        if (!this.isReady || !queryText || this.vectors.size === 0) return [];

        const prepared = this._prepareText(queryText, true);
        console.log('[Horae Vector] Bắt đầu truy vấn embedding...');
        const result = await this._embed([prepared]);
        if (!result?.vectors?.[0]) {
            console.warn('[Horae Vector] embedding trả về kết quả rỗng:', result);
            return [];
        }

        const queryVec = result.vectors[0];
        console.log(`[Horae Vector] Số chiều của vector truy vấn: ${queryVec.length}, bắt đầu đối chiếu với ${this.vectors.size} dòng...`);

        const scored = [];
        const allScored = [];
        let searchedCount = 0;

        for (const [msgIdx, entry] of this.vectors) {
            if (excludeIndices.has(msgIdx)) continue;
            searchedCount++;
            const sim = this._dotProduct(queryVec, entry.vector);
            allScored.push({ messageIndex: msgIdx, similarity: sim, document: entry.document });
            if (sim >= threshold) {
                scored.push({ messageIndex: msgIdx, similarity: sim, document: entry.document });
            }
        }

        allScored.sort((a, b) => b.similarity - a.similarity);
        const bestSim = allScored.length > 0 ? allScored[0].similarity : 0;
        console.log(`[Horae Vector] Đã tìm kiếm ${searchedCount} dòng | Độ tương đồng cao nhất=${bestSim.toFixed(4)} | Vượt ngưỡng (${threshold}): ${scored.length} dòng`);
        if (scored.length === 0 && allScored.length > 0) {
            console.log(`[Horae Vector] Top-5 ứng cử viên dưới ngưỡng:`);
            for (const c of allScored.slice(0, 5)) {
                console.log(`  #${c.messageIndex} sim=${c.similarity.toFixed(4)} | ${c.document.substring(0, 60)}`);
            }
        }

        scored.sort((a, b) => b.similarity - a.similarity);

        const adjusted = pureMode ? scored : this._adjustThresholdByFrequency(scored, threshold);
        if (!pureMode) console.log(`[Horae Vector] Sau khi lọc tần suất: ${adjusted.length} dòng`);

        const deduped = this._deduplicateResults(adjusted);
        console.log(`[Horae Vector] Sau khi loại bỏ trùng lặp: ${deduped.length} dòng`);

        return deduped.slice(0, topK);
    }

    /**
     * Chiến lược B: Phạt đối với nội dung tần suất cao
     * Chỉ khi >80% số từ trong tài liệu là từ phổ biến (xuất hiện trong >60% tài liệu) thì mới tăng ngưỡng một chút,
     * tránh việc những từ xuất hiện với tần suất cao tất yếu như tên nhân vật lại bị loại bỏ nhầm các kết quả hữu ích.
     */
    _adjustThresholdByFrequency(results, baseThreshold) {
        if (results.length < 2 || this.totalDocuments < 10) return results;

        return results.filter(r => {
            const terms = this._extractKeyTerms(r.document);
            if (terms.length === 0) return true;

            let commonCount = 0;
            for (const term of terms) {
                const count = this.termCounts.get(term) || 0;
                if (count / this.totalDocuments > 0.6) commonCount++;
            }
            const commonRatio = commonCount / terms.length;

            if (commonRatio > 0.8) {
                const penalty = (commonRatio - 0.8) * 0.1;
                return r.similarity >= baseThreshold + penalty;
            }
            return true;
        });
    }

    /**
     * Chiến lược C: Gộp gọn các kết quả có độ tương đồng cao
     */
    _deduplicateResults(results) {
        if (results.length <= 1) return results;

        const kept = [results[0]];
        for (let i = 1; i < results.length; i++) {
            const candidate = results[i];
            let isDuplicate = false;
            for (const existing of kept) {
                const mutualSim = this._dotProduct(
                    this.vectors.get(existing.messageIndex)?.vector || [],
                    this.vectors.get(candidate.messageIndex)?.vector || []
                );
                if (mutualSim > 0.92) {
                    isDuplicate = true;
                    break;
                }
            }
            if (!isDuplicate) kept.push(candidate);
        }
        return kept;
    }

    // ========================================
    // Xây dựng Prompt Gọi lại
    // ========================================

    /**
     * Gọi lại thông minh: Truy vấn cấu trúc + Tìm kiếm vector song song, hợp nhất kết quả
     */
    async generateRecallPrompt(horaeManager, skipLast, settings) {
        const chat = horaeManager.getChat();
        const state = horaeManager.getLatestState(skipLast);
        const topK = settings.vectorTopK || 5;
        const threshold = settings.vectorThreshold ?? 0.72;

        let rawUserMsg = '';
        for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i].is_user) { rawUserMsg = chat[i].mes || ''; break; }
        }
        const userQuery = this.cleanUserMessage(rawUserMsg);

        const EXCLUDE_RECENT = 5;
        const excludeIndices = new Set();
        for (let i = Math.max(0, chat.length - EXCLUDE_RECENT); i < chat.length; i++) {
            excludeIndices.add(i);
        }

        const merged = new Map();

        const pureMode = !!settings.vectorPureMode;
        if (pureMode) console.log('[Horae Vector] Đã bật chế độ vector thuần túy, bỏ qua dự đoán theo từ khóa (heuristic)');

        const structuredResults = this._structuredQuery(userQuery, chat, state, excludeIndices, topK, pureMode);
        console.log(`[Horae Vector] Truy vấn cấu trúc: ${structuredResults.length} lần khớp`);
        for (const r of structuredResults) {
            merged.set(r.messageIndex, r);
        }

        const hybridResults = await this._hybridSearch(userQuery, state, horaeManager, skipLast, settings, excludeIndices, topK, threshold, pureMode);
        console.log(`[Horae Vector] Tìm kiếm kết hợp vector: ${hybridResults.length} lần khớp`);
        for (const r of hybridResults) {
            if (!merged.has(r.messageIndex)) {
                merged.set(r.messageIndex, r);
            }
        }

        // Tăng thêm trọng số cho thẻ nhân vật nhiều người:
        // Tập hợp "nhân vật liên quan" = các nhân vật được nhắc đến trong tin nhắn người dùng + các nhân vật đang có mặt
        // Tác động một trọng số dương nhỏ lên các kết quả có liên quan đến những nhân vật đó, ưu tiên gọi lại các sự kiện có liên quan
        // Không lọc bỏ bất kỳ kết quả nào, đảm bảo các tham chiếu vượt qua ranh giới nhân vật (ví dụ như nhắc đến B khi đang nói với A) vẫn có thể gọi lại được
        const relevantChars = new Set(state.scene?.characters_present || []);
        const allKnownChars = new Set();
        for (let i = 0; i < chat.length; i++) {
            const m = chat[i].horae_meta;
            if (!m) continue;
            (m.scene?.characters_present || []).forEach(c => allKnownChars.add(c));
            if (m.npcs) Object.keys(m.npcs).forEach(c => allKnownChars.add(c));
        }
        for (const c of allKnownChars) {
            if (userQuery && userQuery.includes(c)) relevantChars.add(c);
        }

        let results = Array.from(merged.values());
        if (relevantChars.size > 0) {
            for (const r of results) {
                const meta = chat[r.messageIndex]?.horae_meta;
                if (!meta) continue;
                const docChars = new Set([
                    ...(meta.scene?.characters_present || []),
                    ...Object.keys(meta.npcs || {}),
                ]);
                let hasRelevant = false;
                for (const c of relevantChars) {
                    if (docChars.has(c)) { hasRelevant = true; break; }
                }
                if (hasRelevant) {
                    r.similarity += 0.03;
                }
            }
            console.log(`[Horae Vector] Trọng số nhân vật: Các nhân vật liên quan=[${[...relevantChars].join(',')}]`);
        }

        results.sort((a, b) => b.similarity - a.similarity);

        // Rerank: Tinh chỉnh sắp xếp lần hai cho các kết quả ứng cử viên
        if (settings.vectorRerankEnabled && settings.vectorRerankModel && results.length > 1) {
            const rerankCandidates = results.slice(0, topK * 3);
            const rerankQuery = userQuery || this.buildStateQuery(state, null);
            if (rerankQuery) {
                try {
                    const useFullText = !!settings.vectorRerankFullText;
                    const _stripTags = settings.vectorStripTags || '';
                    const rerankDocs = rerankCandidates.map(r => {
                        if (useFullText) {
                            const fullText = this._extractCleanText(chat[r.messageIndex]?.mes, _stripTags);
                            return fullText || r.document;
                        }
                        return r.document;
                    });
                    console.log(`[Horae Vector] Chế độ Rerank: ${useFullText ? 'Tinh chỉnh toàn văn' : 'Sắp xếp tóm tắt'}`);

                    const reranked = await this._rerank(
                        rerankQuery,
                        rerankDocs,
                        topK,
                        settings
                    );
                    if (reranked && reranked.length > 0) {
                        console.log(`[Horae Vector] Rerank hoàn tất: ${reranked.length} dòng`);
                        results = reranked.map(rr => {
                            const original = rerankCandidates[rr.index];
                            return {
                                ...original,
                                similarity: rr.relevance_score,
                                source: original.source + (useFullText ? '+rerank-full' : '+rerank'),
                            };
                        });
                    }
                } catch (err) {
                    console.warn('[Horae Vector] Rerank thất bại, sử dụng sắp xếp gốc:', err.message);
                }
            }
        }

        results = results.slice(0, topK);

        console.log(`[Horae Vector] === Hợp nhất cuối cùng: ${results.length} dòng ===`);
        for (const r of results) {
            console.log(`  #${r.messageIndex} sim=${r.similarity.toFixed(3)} [${r.source}]`);
        }

        if (results.length === 0) return '';

        const currentDate = state.timestamp?.story_date;
        const fullTextCount = Math.min(settings.vectorFullTextCount ?? 3, topK);
        const fullTextThreshold = settings.vectorFullTextThreshold ?? 0.9;
        const recallText = this._buildRecallText(results, currentDate, chat, fullTextCount, fullTextThreshold, settings.vectorStripTags || '');
        console.log(`[Horae Vector] Văn bản gọi lại (${recallText.length} chữ):\n${recallText}`);
        return recallText;
    }

    // ========================================
    // Truy vấn cấu trúc (Chính xác, không cần vector)
    // ========================================

    /**
     * Phân tích ý định từ tin nhắn người dùng, truy vấn trực tiếp dữ liệu cấu trúc horae_meta
     */
    _structuredQuery(userQuery, chat, state, excludeIndices, topK, pureMode = false) {
        if (!userQuery || chat.length === 0) return [];

        const knownChars = new Set();
        for (let i = 0; i < chat.length; i++) {
            const m = chat[i].horae_meta;
            if (!m) continue;
            (m.scene?.characters_present || []).forEach(c => knownChars.add(c));
            if (m.npcs) Object.keys(m.npcs).forEach(c => knownChars.add(c));
        }

        const mentionedChars = [];
        for (const c of knownChars) {
            if (userQuery.includes(c)) mentionedChars.push(c);
        }

        const isFirst = /lần đầu|đầu tiên|bắt đầu|mới gặp|sớm nhất/.test(userQuery);
        const isLast = /lần trước|cuối cùng|gần đây nhất|trước đây/.test(userQuery);

        const hasCostumeKw = /mặc|đội|thay|áo|quần|váy|trang phục|đồ|giày/.test(userQuery);
        const hasMoodKw = /tức giận|phẫn nộ|vui vẻ|vui mừng|buồn bã|đau lòng|khóc|sợ hãi|hoảng sợ|xấu hổ|đắc ý|thỏa mãn|ghen tị|bi thương|lo lắng|căng thẳng|hưng phấn|cảm động|dịu dàng|lạnh lùng/.test(userQuery);
        const hasGiftKw = /quà tặng|tặng|đưa cho|nhận được|tín vật|định tình|của hồi môn|sính lễ|đồ lưu niệm|thiệp/.test(userQuery);
        const hasImportantItemKw = /(vật phẩm|đồ vật|đạo cụ|bảo vật) quan trọng|(vật phẩm|đồ vật|đạo cụ) then chốt|trân quý|bảo bối|thần khí|bí bảo|thánh vật/.test(userQuery);
        const hasImportantEventKw = /(việc|sự kiện|trải nghiệm) quan trọng|(việc|sự kiện|bước ngoặt) then chốt|việc lớn|bước ngoặt|cột mốc/.test(userQuery);
        const hasCeremonyKw = /hôn lễ|tang lễ|nghi thức|buổi lễ|lễ mừng|lễ hội|tế lễ|lên ngôi|sắc phong|tuyên thệ|lễ rửa tội|lễ trưởng thành|chúc mừng|yến tiệc|vũ hội|tế điển/.test(userQuery);
        const hasPromiseKw = /lời hứa|lời thề|giao ước|đảm bảo|thề|lập lời thề|khế ước|minh ước|hứa hẹn/.test(userQuery);
        const hasLossKw = /tử vong|qua đời|hy sinh|chia ly|xa cách|từ biệt|đánh mất|biến mất|ngã xuống|vĩnh biệt|quyết biệt|tử trận/.test(userQuery);
        const hasRevelationKw = /bí mật|sự thật|vạch trần|thú nhận|bại lộ|thân phận thật sự|che giấu|lời nói dối|lừa gạt|ngụy trang|mạo danh|tên thật|huyết thống|thân thế/.test(userQuery);
        const hasPowerKw = /thức tỉnh|thăng cấp|tiến hóa|đột phá|suy thoái|mất đi sức mạnh|mở phong ấn|phong ấn|biến hình|biến dị|có được sức mạnh|huyết mạch|kế thừa|truyền thừa|lĩnh ngộ/.test(userQuery);

        const results = [];

        if (isFirst && mentionedChars.length > 0) {
            for (const charName of mentionedChars) {
                const idx = this._findFirstAppearance(chat, charName, excludeIndices);
                if (idx !== -1) {
                    results.push({ messageIndex: idx, similarity: 1.0, document: `[Cấu trúc] Sự xuất hiện đầu tiên của ${charName}`, source: 'structured' });
                    console.log(`[Horae Vector] Truy vấn cấu trúc: "${charName}" xuất hiện lần đầu tại #${idx}`);
                }
            }
        }

        if (isLast && mentionedChars.length > 0 && hasCostumeKw) {
            const costumeKw = this._extractCostumeKeywords(userQuery, mentionedChars);
            if (costumeKw) {
                for (const charName of mentionedChars) {
                    const idx = this._findLastCostume(chat, charName, costumeKw, excludeIndices);
                    if (idx !== -1) {
                        results.push({ messageIndex: idx, similarity: 1.0, document: `[Cấu trúc] ${charName} mặc ${costumeKw}`, source: 'structured' });
                        console.log(`[Horae Vector] Truy vấn cấu trúc: "${charName}" mặc "${costumeKw}" lần trước tại #${idx}`);
                    }
                }
            }
        }

        if (hasCostumeKw && !isFirst && !isLast && mentionedChars.length === 0) {
            const costumeKw = this._extractCostumeKeywords(userQuery, []);
            if (costumeKw) {
                const matches = this._findCostumeMatches(chat, costumeKw, excludeIndices, topK);
                for (const m of matches) {
                    results.push({ messageIndex: m.idx, similarity: 0.95, document: `[Cấu trúc] Khớp trang phục:${costumeKw}`, source: 'structured' });
                }
            }
        }

        if (isLast && hasMoodKw) {
            const moodKw = this._extractMoodKeyword(userQuery);
            if (moodKw) {
                const targetChar = mentionedChars[0] || null;
                const idx = this._findLastMood(chat, targetChar, moodKw, excludeIndices);
                if (idx !== -1) {
                    results.push({ messageIndex: idx, similarity: 1.0, document: `[Cấu trúc] Khớp cảm xúc:${moodKw}`, source: 'structured' });
                    console.log(`[Horae Vector] Truy vấn cấu trúc: Lần trước "${moodKw}" tại #${idx}`);
                }
            }
        }

        if (hasGiftKw) {
            const giftResults = this._findGiftItems(chat, mentionedChars, excludeIndices, topK);
            for (const r of giftResults) {
                results.push(r);
                console.log(`[Horae Vector] Truy vấn cấu trúc: Quà tặng/Đồ tặng #${r.messageIndex} [${r.document}]`);
            }
        }

        if (hasImportantItemKw) {
            const impResults = this._findImportantItems(chat, excludeIndices, topK);
            for (const r of impResults) {
                results.push(r);
                console.log(`[Horae Vector] Truy vấn cấu trúc: Vật phẩm quan trọng #${r.messageIndex} [${r.document}]`);
            }
        }

        if (hasImportantEventKw) {
            const evtResults = this._findImportantEvents(chat, excludeIndices, topK);
            for (const r of evtResults) {
                results.push(r);
                console.log(`[Horae Vector] Truy vấn cấu trúc: Sự kiện quan trọng #${r.messageIndex} [${r.document}]`);
            }
        }

        // Ở chế độ vector thuần túy sẽ bỏ qua dự đoán theo từ khóa (tìm kiếm sự kiện theo chủ đề, khớp cụm từ sự kiện), hoàn toàn phụ thuộc vào ngữ nghĩa vector
        if (!pureMode) {
            if (hasCeremonyKw || hasPromiseKw || hasLossKw || hasRevelationKw || hasPowerKw) {
                const thematicResults = this._findThematicEvents(chat, {
                    ceremony: hasCeremonyKw, promise: hasPromiseKw,
                    loss: hasLossKw, revelation: hasRevelationKw, power: hasPowerKw,
                }, excludeIndices, topK);
                for (const r of thematicResults) {
                    results.push(r);
                    console.log(`[Horae Vector] Truy vấn cấu trúc: Sự kiện theo chủ đề #${r.messageIndex} [${r.document}]`);
                }
            }

            const existingIds = new Set(results.map(r => r.messageIndex));
            const eventMatches = this._eventKeywordSearch(userQuery, chat, mentionedChars, existingIds, excludeIndices, topK);
            for (const m of eventMatches) {
                results.push(m);
            }
        }

        const withContext = this._expandContextWindow(results, chat, excludeIndices);
        return withContext.slice(0, topK);
    }

    /**
     * Mở rộng cửa sổ ngữ cảnh: Đối với mỗi tin nhắn được chọn, thêm các tin nhắn AI liền kề trước và sau
     * Trong RP (nhập vai), các tin nhắn liền kề là các sự kiện liên tục, có liên quan tự nhiên với nhau
     */
    _expandContextWindow(results, chat, excludeIndices) {
        const resultIds = new Set(results.map(r => r.messageIndex));
        const contextToAdd = [];

        for (const r of results) {
            const idx = r.messageIndex;

            for (let i = idx - 1; i >= Math.max(0, idx - 3); i--) {
                if (excludeIndices.has(i) || resultIds.has(i)) continue;
                const m = chat[i].horae_meta;
                if (!chat[i].is_user && this._hasOriginalEvents(m)) {
                    contextToAdd.push({
                        messageIndex: i,
                        similarity: r.similarity * 0.85,
                        document: `[Ngữ cảnh trước] Sự kiện tiền đề của #${idx}`,
                        source: 'context',
                    });
                    resultIds.add(i);
                    break;
                }
            }

            for (let i = idx + 1; i <= Math.min(chat.length - 1, idx + 3); i++) {
                if (excludeIndices.has(i) || resultIds.has(i)) continue;
                const m = chat[i].horae_meta;
                if (!chat[i].is_user && this._hasOriginalEvents(m)) {
                    contextToAdd.push({
                        messageIndex: i,
                        similarity: r.similarity * 0.85,
                        document: `[Ngữ cảnh sau] Sự kiện tiếp nối của #${idx}`,
                        source: 'context',
                    });
                    resultIds.add(i);
                    break;
                }
            }
        }

        if (contextToAdd.length > 0) {
            console.log(`[Horae Vector] Mở rộng ngữ cảnh: +${contextToAdd.length} dòng`);
            for (const c of contextToAdd) console.log(`  #${c.messageIndex} [${c.document}]`);
        }

        const all = [...results, ...contextToAdd];
        all.sort((a, b) => b.similarity - a.similarity);
        return all;
    }

    /**
     * Tìm kiếm từ khóa sự kiện: Quét trực tiếp các từ vựng thuộc danh mục đã biết từ văn bản người dùng, sau khi mở rộng thì tìm kiếm tóm tắt sự kiện
     */
    _eventKeywordSearch(userQuery, chat, mentionedChars, skipIds, excludeIndices, limit) {
        const detected = this._detectCategoryTerms(userQuery);
        if (detected.length === 0) return [];

        const expanded = this._expandByCategory(detected);
        console.log(`[Horae Vector] Tìm kiếm sự kiện: Đã phát hiện=[${detected.join(',')}] Sau khi mở rộng=[${expanded.join(',')}]`);

        const scored = [];
        for (let i = 0; i < chat.length; i++) {
            if (excludeIndices.has(i) || skipIds.has(i)) continue;
            const meta = chat[i].horae_meta;
            if (!meta) continue;

            const searchText = this._buildSearchableText(meta);
            if (!searchText) continue;

            let matchCount = 0;
            const matched = [];
            for (const kw of expanded) {
                if (searchText.includes(kw)) {
                    matchCount++;
                    matched.push(kw);
                }
            }

            if (matchCount >= 2 || (matchCount >= 1 && mentionedChars.some(c => searchText.includes(c)))) {
                scored.push({
                    messageIndex: i,
                    similarity: 0.85 + matchCount * 0.02,
                    document: `[Khớp sự kiện] ${matched.join(',')}`,
                    source: 'structured',
                    _matchCount: matchCount,
                });
            }
        }

        scored.sort((a, b) => b._matchCount - a._matchCount || b.similarity - a.similarity);
        const top = scored.slice(0, limit);
        if (top.length > 0) {
            console.log(`[Horae Vector] Tìm kiếm sự kiện đã trúng ${top.length} dòng:`);
            for (const r of top) console.log(`  #${r.messageIndex} matches=${r._matchCount} [${r.document}]`);
        }
        return top;
    }

    _buildSearchableText(meta) {
        const parts = [];
        if (meta.events) {
            for (const evt of meta.events) {
                if (evt.isSummary || evt.level === 'Tóm tắt' || evt._summaryId) continue;
                if (evt.summary) parts.push(evt.summary);
            }
        }
        if (meta.scene?.location) parts.push(meta.scene.location);
        if (meta.npcs) {
            for (const [name, info] of Object.entries(meta.npcs)) {
                parts.push(name);
                if (info.description) parts.push(info.description);
            }
        }
        if (meta.items) {
            for (const [name, info] of Object.entries(meta.items)) {
                parts.push(name);
                if (info.location) parts.push(info.location);
            }
        }
        return parts.join(' ');
    }

    /**
     * Quét trực tiếp các từ vựng đã biết trong TERM_CATEGORIES từ văn bản người dùng (không cần tách từ)
     */
    _detectCategoryTerms(text) {
        const found = [];
        for (const terms of Object.values(TERM_CATEGORIES)) {
            for (const term of terms) {
                if (text.includes(term)) {
                    found.push(term);
                }
            }
        }
        return [...new Set(found)];
    }

    /**
     * Mở rộng các từ đã phát hiện thành tất cả các từ thuộc cùng danh mục
     */
    _expandByCategory(keywords) {
        const expanded = new Set(keywords);
        for (const kw of keywords) {
            for (const terms of Object.values(TERM_CATEGORIES)) {
                if (terms.includes(kw)) {
                    for (const t of terms) expanded.add(t);
                }
            }
        }
        return [...expanded];
    }

    _findFirstAppearance(chat, charName, excludeIndices) {
        for (let i = 0; i < chat.length; i++) {
            if (excludeIndices.has(i)) continue;
            const m = chat[i].horae_meta;
            if (!m) continue;
            if (m.npcs && m.npcs[charName]) return i;
            if (m.scene?.characters_present?.includes(charName)) return i;
        }
        return -1;
    }

    _findLastCostume(chat, charName, costumeKw, excludeIndices) {
        for (let i = chat.length - 1; i >= 0; i--) {
            if (excludeIndices.has(i)) continue;
            const costume = chat[i].horae_meta?.costumes?.[charName];
            if (costume && costume.includes(costumeKw)) return i;
        }
        return -1;
    }

    _findCostumeMatches(chat, costumeKw, excludeIndices, limit) {
        const matches = [];
        for (let i = chat.length - 1; i >= 0 && matches.length < limit; i--) {
            if (excludeIndices.has(i)) continue;
            const costumes = chat[i].horae_meta?.costumes;
            if (!costumes) continue;
            for (const v of Object.values(costumes)) {
                if (v && v.includes(costumeKw)) { matches.push({ idx: i }); break; }
            }
        }
        return matches;
    }

    _findLastMood(chat, charName, moodKw, excludeIndices) {
        for (let i = chat.length - 1; i >= 0; i--) {
            if (excludeIndices.has(i)) continue;
            const mood = chat[i].horae_meta?.mood;
            if (!mood) continue;
            if (charName) {
                if (mood[charName] && mood[charName].includes(moodKw)) return i;
            } else {
                for (const v of Object.values(mood)) {
                    if (v && v.includes(moodKw)) return i;
                }
            }
        }
        return -1;
    }

    _extractCostumeKeywords(query, chars) {
        let cleaned = query;
        for (const c of chars) cleaned = cleaned.replace(c, '');
        cleaned = cleaned.replace(/lần trước|cuối cùng|gần đây nhất|trước đây|mặc|đội|thay|của|đã|qua|đang|bộ đó|cái đó/g, '').trim();
        return cleaned.length >= 2 ? cleaned : '';
    }

    _extractMoodKeyword(query) {
        const moodWords = ['tức giận', 'phẫn nộ', 'vui vẻ', 'vui mừng', 'buồn bã', 'đau lòng', 'khóc', 'sợ hãi', 'hoảng sợ', 'xấu hổ', 'đắc ý', 'thỏa mãn', 'ghen tị', 'bi thương', 'lo lắng', 'căng thẳng', 'hưng phấn', 'cảm động', 'dịu dàng', 'lạnh lùng', 'nổi giận', 'tủi thân', 'suy sụp'];
        for (const w of moodWords) {
            if (query.includes(w)) return w;
        }
        return '';
    }

    /**
     * Tìm kiếm các tin nhắn liên quan đến quà tặng/đồ được tặng
     * Định vị thông qua sự thay đổi của item.holder hoặc các từ khóa tặng quà trong văn bản sự kiện
     */
    _findGiftItems(chat, mentionedChars, excludeIndices, limit) {
        const giftKws = ['quà tặng', 'tặng', 'đưa cho', 'nhận được', 'tín vật', 'định tình', 'của hồi môn', 'sính lễ', 'đồ lưu niệm'];
        const results = [];
        const seen = new Set();

        for (let i = chat.length - 1; i >= 0 && results.length < limit; i--) {
            if (excludeIndices.has(i) || seen.has(i)) continue;
            const meta = chat[i].horae_meta;
            if (!meta) continue;

            let matched = false;
            const matchedItems = [];

            if (meta.items) {
                for (const [name, info] of Object.entries(meta.items)) {
                    const imp = info.importance || '';
                    const holder = info.holder || '';
                    const holderMatchesChar = mentionedChars.length === 0 || mentionedChars.some(c => holder.includes(c));

                    if ((imp === '!' || imp === '!!') && holderMatchesChar) {
                        matched = true;
                        matchedItems.push(`${imp === '!!' ? 'Then chốt' : 'Quan trọng'}:${name}`);
                    }
                }
            }

            if (!matched && meta.events) {
                for (const evt of meta.events) {
                    if (evt.isSummary || evt.level === 'Tóm tắt' || evt._summaryId) continue;
                    const text = evt.summary || '';
                    if (giftKws.some(kw => text.includes(kw))) {
                        if (mentionedChars.length === 0 || mentionedChars.some(c => text.includes(c))) {
                            matched = true;
                            matchedItems.push(text.substring(0, 20));
                        }
                    }
                }
            }

            if (matched) {
                seen.add(i);
                results.push({
                    messageIndex: i,
                    similarity: 0.95,
                    document: `[Cấu trúc] Quà tặng/Đồ tặng: ${matchedItems.join('; ')}`,
                    source: 'structured',
                });
            }
        }
        return results;
    }

    /**
     * Tìm kiếm các tin nhắn chứa vật phẩm quan trọng/then chốt (importance '!' hoặc '!!')
     */
    _findImportantItems(chat, excludeIndices, limit) {
        const results = [];
        for (let i = chat.length - 1; i >= 0 && results.length < limit; i--) {
            if (excludeIndices.has(i)) continue;
            const meta = chat[i].horae_meta;
            if (!meta?.items) continue;

            const importantNames = [];
            for (const [name, info] of Object.entries(meta.items)) {
                if (info.importance === '!' || info.importance === '!!') {
                    importantNames.push(`${info.importance === '!!' ? '★' : '☆'}${info.icon || ''}${name}`);
                }
            }
            if (importantNames.length > 0) {
                results.push({
                    messageIndex: i,
                    similarity: 0.95,
                    document: `[Cấu trúc] Vật phẩm quan trọng: ${importantNames.join(', ')}`,
                    source: 'structured',
                });
            }
        }
        return results;
    }

    /**
     * Tìm kiếm các sự kiện ở mức độ quan trọng/then chốt
     */
    _findImportantEvents(chat, excludeIndices, limit) {
        const results = [];
        for (let i = chat.length - 1; i >= 0 && results.length < limit; i--) {
            if (excludeIndices.has(i)) continue;
            const meta = chat[i].horae_meta;
            if (!meta?.events) continue;

            for (const evt of meta.events) {
                if (evt.isSummary || evt.level === 'Tóm tắt' || evt._summaryId) continue;
                if (evt.level === 'Quan trọng' || evt.level === 'Quan trọng (Chìa khóa)') {
                    results.push({
                        messageIndex: i,
                        similarity: evt.level === 'Quan trọng (Chìa khóa)' ? 1.0 : 0.95,
                        document: `[Cấu trúc] Sự kiện ${evt.level}: ${(evt.summary || '').substring(0, 30)}`,
                        source: 'structured',
                    });
                    break;
                }
            }
        }
        return results;
    }

    /**
     * Tìm kiếm sự kiện theo chủ đề: Nghi lễ/Lời hứa/Mất mát/Vạch trần/Thay đổi sức mạnh
     * Kết hợp văn bản sự kiện và TERM_CATEGORIES để khớp chính xác
     */
    _findThematicEvents(chat, flags, excludeIndices, limit) {
        const activeCategories = [];
        if (flags.ceremony) activeCategories.push('ceremony');
        if (flags.promise) activeCategories.push('promise');
        if (flags.loss) activeCategories.push('loss');
        if (flags.revelation) activeCategories.push('revelation');
        if (flags.power) activeCategories.push('power');

        const searchTerms = new Set();
        for (const cat of activeCategories) {
            if (TERM_CATEGORIES[cat]) {
                for (const t of TERM_CATEGORIES[cat]) searchTerms.add(t);
            }
        }
        if (searchTerms.size === 0) return [];

        const results = [];
        for (let i = chat.length - 1; i >= 0 && results.length < limit; i--) {
            if (excludeIndices.has(i)) continue;
            const meta = chat[i].horae_meta;
            if (!meta?.events) continue;

            for (const evt of meta.events) {
                if (evt.isSummary || evt.level === 'Tóm tắt' || evt._summaryId) continue;
                const text = evt.summary || '';
                const hits = [...searchTerms].filter(t => text.includes(t));
                if (hits.length > 0) {
                    results.push({
                        messageIndex: i,
                        similarity: 0.90 + Math.min(hits.length, 5) * 0.02,
                        document: `[Cấu trúc] Sự kiện theo chủ đề(${activeCategories.join('+')}): ${hits.join(',')}`,
                        source: 'structured',
                    });
                    break;
                }
            }
        }
        return results;
    }

    // ========================================
    // Tìm kiếm kết hợp Vector + Từ khóa (Phương án dự phòng cuối)
    // ========================================

    async _hybridSearch(userQuery, state, horaeManager, skipLast, settings, excludeIndices, topK, threshold, pureMode = false) {
        if (!this.isReady || this.vectors.size === 0) return [];

        const lastIdx = Math.max(0, horaeManager.getChat().length - 1 - skipLast);
        const lastMeta = horaeManager.getMessageMeta(lastIdx);
        const stateQuery = this.buildStateQuery(state, lastMeta);

        const merged = new Map();

        if (userQuery) {
            const intentThreshold = Math.max(threshold - 0.25, 0.4);
            const intentResults = await this.search(userQuery, topK * 2, intentThreshold, excludeIndices, pureMode);
            console.log(`[Horae Vector] Tìm kiếm theo ý định: ${intentResults.length} dòng`);
            for (const r of intentResults) {
                merged.set(r.messageIndex, { ...r, source: 'intent' });
            }
        }

        if (stateQuery) {
            const stateResults = await this.search(stateQuery, topK * 2, threshold, excludeIndices, pureMode);
            console.log(`[Horae Vector] Tìm kiếm theo trạng thái: ${stateResults.length} dòng`);
            for (const r of stateResults) {
                const existing = merged.get(r.messageIndex);
                if (!existing || r.similarity > existing.similarity) {
                    merged.set(r.messageIndex, { ...r, source: existing ? 'both' : 'state' });
                }
            }
        }

        let results = Array.from(merged.values());
        results.sort((a, b) => b.similarity - a.similarity);
        results = this._deduplicateResults(results).slice(0, topK);

        console.log(`[Horae Vector] Kết quả tìm kiếm kết hợp: ${results.length} dòng`);
        for (const r of results) {
            console.log(`  #${r.messageIndex} sim=${r.similarity.toFixed(4)} [${r.source}] | ${r.document.substring(0, 80)}`);
        }

        return results;
    }

    _buildRecallText(results, currentDate, chat, fullTextCount = 3, fullTextThreshold = 0.9, stripTags = '') {
        const lines = ['[Hồi tưởng ký ức —— Dưới đây là các phân đoạn lịch sử liên quan đến tình huống hiện tại, chỉ mang tính chất tham khảo, không phải là ngữ cảnh hiện tại]'];

        for (let rank = 0; rank < results.length; rank++) {
            const r = results[rank];
            const meta = chat[r.messageIndex]?.horae_meta;
            if (!meta) continue;

            const isFullText = fullTextCount > 0 && rank < fullTextCount && r.similarity >= fullTextThreshold;

            if (isFullText) {
                const rawText = this._extractCleanText(chat[r.messageIndex]?.mes, stripTags);
                if (rawText) {
                    const timeTag = this._buildTimeTag(meta?.timestamp, currentDate);
                    lines.push(`#${r.messageIndex} ${timeTag ? timeTag + ' ' : ''}[Xem lại toàn văn]\n${rawText}`);
                    continue;
                }
            }

            const parts = [];

            const timeTag = this._buildTimeTag(meta?.timestamp, currentDate);
            if (timeTag) parts.push(timeTag);

            if (meta?.scene?.location) parts.push(`Cảnh vật:${meta.scene.location}`);

            const chars = meta?.scene?.characters_present || [];
            const costumes = meta?.costumes || {};
            for (const c of chars) {
                parts.push(costumes[c] ? `${c}(${costumes[c]})` : c);
            }

            if (meta?.events?.length > 0) {
                for (const evt of meta.events) {
                    if (evt.isSummary || evt.level === 'Tóm tắt') continue;
                    const mark = evt.level === 'Quan trọng (Chìa khóa)' ? '★' : evt.level === 'Quan trọng' ? '●' : '○';
                    if (evt.summary) parts.push(`${mark}${evt.summary}`);
                }
            }

            if (meta?.npcs) {
                for (const [name, info] of Object.entries(meta.npcs)) {
                    let s = `NPC:${name}`;
                    if (info.relationship) s += `(${info.relationship})`;
                    parts.push(s);
                }
            }

            if (meta?.items && Object.keys(meta.items).length > 0) {
                for (const [name, info] of Object.entries(meta.items)) {
                    let s = `${info.icon || ''}${name}`;
                    if (info.holder) s += `=${info.holder}`;
                    parts.push(s);
                }
            }

            if (parts.length > 0) {
                lines.push(`#${r.messageIndex} ${parts.join(' | ')}`);
            }
        }

        return lines.length > 1 ? lines.join('\n') : '';
    }

    _extractCleanText(mes, stripTags) {
        if (!mes) return '';
        let text = mes
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
            .replace(//g, '');
        if (stripTags) {
            const tags = stripTags.split(/[,，\s]+/).map(t => t.trim()).filter(Boolean);
            for (const tag of tags) {
                const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                text = text.replace(new RegExp(`<${escaped}(?:\\s[^>]*)?>[\\s\\S]*?</${escaped}>`, 'gi'), '');
            }
        }
        return text.replace(/<[^>]*>/g, '').trim();
    }

    /**
     * Xây dựng thẻ thời gian: (Thời gian tương đối Ngày tháng tuyệt đối Thời gian)
     * Ví dụ: (Hôm kia Ngày mùng 1 tháng Sương Giáng 19:10) hoặc (Hôm nay 07:55)
     */
    _buildTimeTag(timestamp, currentDate) {
        if (!timestamp) return '';

        const storyDate = timestamp.story_date;
        const storyTime = timestamp.story_time;
        const parts = [];

        if (storyDate && currentDate) {
            const relDesc = this._getRelativeTimeDesc(storyDate, currentDate);
            if (relDesc) {
                parts.push(relDesc.replace(/[()]/g, ''));
            }
        }

        if (storyDate) parts.push(storyDate);
        if (storyTime) parts.push(storyTime);

        if (parts.length === 0) return '';

        const combined = parts.join(' ');
        return `(${combined})`;
    }

    _getRelativeTimeDesc(eventDate, currentDate) {
        if (!eventDate || !currentDate) return '';
        const result = calculateDetailedRelativeTime(eventDate, currentDate);
        if (result.days === null || result.days === undefined) return '';

        const { days, fromDate, toDate } = result;
        if (days === 0) return '(Hôm nay)';
        if (days === 1) return '(Hôm qua)';
        if (days === 2) return '(Hôm kia)';
        if (days === 3) return '(Ba ngày trước)';
        if (days >= 4 && days <= 13 && fromDate) {
            const WD = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
            return `(${WD[fromDate.getDay()]} tuần trước)`;
        }
        if (days >= 20 && days < 60 && fromDate && toDate && fromDate.getMonth() !== toDate.getMonth()) {
            return `(Ngày ${fromDate.getDate()} tháng trước)`;
        }
        if (days >= 300 && fromDate && toDate && fromDate.getFullYear() < toDate.getFullYear()) {
            return `(Tháng ${fromDate.getMonth() + 1} năm ngoái)`;
        }
        if (days > 0 && days < 30) return `(${days} ngày trước)`;
        if (days > 0) return `(${Math.round(days / 30)} tháng trước)`;
        return '';
    }

    // ========================================
    // Giao tiếp với Worker
    // ========================================

    _embed(texts) {
        if (this.isApiMode) return this._embedApi(texts);
        if (!this.worker) return Promise.resolve(null);
        const id = ++this._callId;
        return new Promise((resolve, reject) => {
            this._pendingCallbacks.set(id, { resolve, reject });
            this.worker.postMessage({ type: 'embed', id, data: { texts } });
            setTimeout(() => {
                if (this._pendingCallbacks.has(id)) {
                    this._pendingCallbacks.delete(id);
                    reject(new Error('Hết thời gian embedding (Embedding timeout)'));
                }
            }, 30000);
        });
    }

    async _embedApi(texts) {
        const endpoint = `${this._apiUrl}/embeddings`;
        try {
            const resp = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this._apiKey}`,
                },
                body: JSON.stringify({
                    model: this._apiModel,
                    input: texts,
                }),
            });
            if (!resp.ok) {
                const errText = await resp.text().catch(() => '');
                throw new Error(`API ${resp.status}: ${errText.slice(0, 200)}`);
            }
            const json = await resp.json();
            if (!json.data || !Array.isArray(json.data)) {
                throw new Error('Định dạng API trả về bất thường: thiếu mảng data');
            }
            const vectors = json.data
                .sort((a, b) => a.index - b.index)
                .map(d => d.embedding);
            return { vectors };
        } catch (err) {
            console.error('[Horae Vector] Lấy API embedding thất bại:', err);
            throw err;
        }
    }

    /**
     * Gọi Rerank API (Định dạng tương thích Cohere/Jina/Qwen)
     * @returns {Array<{index: number, relevance_score: number}>}
     */
    async _rerank(query, documents, topN, settings) {
        const baseUrl = (settings.vectorRerankUrl || settings.vectorApiUrl || '').replace(/\/+$/, '');
        const apiKey = settings.vectorRerankKey || settings.vectorApiKey || '';
        const model = settings.vectorRerankModel || '';

        if (!baseUrl || !model) throw new Error('Chưa cấu hình địa chỉ API hoặc mô hình Rerank');

        const endpoint = `${baseUrl}/rerank`;
        console.log(`[Horae Vector] Yêu cầu Rerank: ${documents.length} ứng cử viên → ${endpoint}`);

        const resp = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                query,
                documents,
                top_n: topN,
            }),
        });

        if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            throw new Error(`Rerank API ${resp.status}: ${errText.slice(0, 200)}`);
        }

        const json = await resp.json();
        const results = json.results || json.data;
        if (!Array.isArray(results)) {
            throw new Error('Định dạng Rerank API trả về bất thường: thiếu mảng results');
        }

        return results.map(r => ({
            index: r.index,
            relevance_score: r.relevance_score ?? r.score ?? 0,
        })).sort((a, b) => b.relevance_score - a.relevance_score);
    }

    // ========================================
    // IndexedDB
    // ========================================

    async _openDB() {
        if (this.db) {
            try {
                this.db.transaction(STORE_NAME, 'readonly');
                return;
            } catch (_) {
                console.warn('[Horae Vector] Kết nối DB đã cũ, đang kết nối lại...');
                try { this.db.close(); } catch (__) {}
                this.db = null;
            }
        }
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
                    store.createIndex('chatId', 'chatId', { unique: false });
                }
            };
            req.onblocked = () => {
                console.warn('[Horae Vector] Nâng cấp DB bị chặn bởi tab khác, đang đóng kết nối cũ');
            };
            req.onsuccess = () => {
                this.db = req.result;
                this.db.onversionchange = () => {
                    this.db.close();
                    this.db = null;
                    console.log('[Horae Vector] DB đã đóng do thay đổi phiên bản ở một tab khác');
                };
                this.db.onclose = () => { this.db = null; };
                resolve();
            };
            req.onerror = () => reject(req.error);
        });
    }

    async _saveVector(messageIndex, data) {
        await this._openDB();
        const key = `${this.chatId}_${messageIndex}`;
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put({
                key,
                chatId: this.chatId,
                messageIndex,
                vector: data.vector,
                hash: data.hash,
                document: data.document,
            });
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    }

    async _loadAllVectors() {
        await this._openDB();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readonly');
            const index = tx.objectStore(STORE_NAME).index('chatId');
            const req = index.getAll(this.chatId);
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    async _deleteVector(messageIndex) {
        await this._openDB();
        const key = `${this.chatId}_${messageIndex}`;
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(key);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    }

    async _clearVectors() {
        await this._openDB();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const index = store.index('chatId');
            const req = index.openCursor(this.chatId);
            req.onsuccess = () => {
                const cursor = req.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    }

    // ========================================
    // Hàm tiện ích
    // ========================================

    _hasOriginalEvents(meta) {
        if (!meta?.events?.length) return false;
        return meta.events.some(e => !e.isSummary && e.level !== 'Tóm tắt' && !e._summaryId);
    }

    _dotProduct(a, b) {
        if (!a || !b || a.length !== b.length) return 0;
        let sum = 0;
        for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
        return sum;
    }

    _hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString(36);
    }

    _extractKeyTerms(document) {
        return document
            .split(/[\s|,，。！？：；、()\[\]（）\n]+/)
            .filter(t => t.length >= 2 && t.length <= 20);
    }

    _updateTermCounts(document, delta) {
        const terms = this._extractKeyTerms(document);
        const unique = new Set(terms);
        for (const term of unique) {
            const prev = this.termCounts.get(term) || 0;
            const next = prev + delta;
            if (next <= 0) this.termCounts.delete(term);
            else this.termCounts.set(term, next);
        }
    }

    _prepareText(text, isQuery) {
        const cfg = MODEL_CONFIG[this.modelName];
        if (cfg?.prefix) {
            return isQuery ? `${cfg.prefix.query}${text}` : `${cfg.prefix.passage}${text}`;
        }
        return text;
    }
}

export const vectorManager = new VectorManager();