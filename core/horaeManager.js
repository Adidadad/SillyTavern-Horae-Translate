/**
 * Horae - Trình quản lý Cốt lõi
 * Chịu trách nhiệm lưu trữ, phân tích, tổng hợp siêu dữ liệu (metadata)
 */

import { parseStoryDate, calculateRelativeTime, calculateDetailedRelativeTime, generateTimeReference, formatRelativeTime, formatFullDateTime } from '../utils/timeUtils.js';

/**
 * @typedef {Object} HoraeTimestamp
 * @property {string} story_date - Ngày tháng cốt truyện, ví dụ "10/1"
 * @property {string} story_time - Thời gian cốt truyện, ví dụ "15:00" hoặc "Buổi chiều"
 * @property {string} absolute - Dấu thời gian thực tế ở định dạng ISO
 */

/**
 * @typedef {Object} HoraeScene
 * @property {string} location - Địa điểm bối cảnh
 * @property {string[]} characters_present - Danh sách nhân vật có mặt
 * @property {string} atmosphere - Bầu không khí bối cảnh
 */

/**
 * @typedef {Object} HoraeEvent
 * @property {boolean} is_important - Có phải là sự kiện quan trọng không
 * @property {string} level - Cấp độ sự kiện: Bình thường/Quan trọng/Quan trọng (Chìa khóa)
 * @property {string} summary - Tóm tắt sự kiện
 */

/**
 * @typedef {Object} HoraeItemInfo
 * @property {string|null} icon - Biểu tượng emoji
 * @property {string|null} holder - Người nắm giữ
 * @property {string} location - Mô tả vị trí
 */

/**
 * @typedef {Object} HoraeMeta
 * @property {HoraeTimestamp} timestamp
 * @property {HoraeScene} scene
 * @property {Object.<string, string>} costumes - Trang phục nhân vật {Tên nhân vật: Mô tả trang phục}
 * @property {Object.<string, HoraeItemInfo>} items - Theo dõi vật phẩm
 * @property {HoraeEvent|null} event
 * @property {Object.<string, string|number>} affection - Độ hảo cảm
 * @property {Object.<string, {description: string, first_seen: string}>} npcs - NPC tạm thời
 */

/** Tạo đối tượng siêu dữ liệu (metadata) trống */
export function createEmptyMeta() {
    return {
        timestamp: {
            story_date: '',
            story_time: '',
            absolute: ''
        },
        scene: {
            location: '',
            characters_present: [],
            atmosphere: ''
        },
        costumes: {},
        items: {},
        deletedItems: [],
        events: [],
        affection: {},
        npcs: {},
        agenda: [],
        mood: {},
        relationships: [],
    };
}

/**
 * Trích xuất tên cơ bản của vật phẩm (Bỏ ngoặc số lượng ở cuối)
 * "Xương bò tươi (5 cân)" → "Xương bò tươi"
 * "Nước sạch (9L)" → "Nước sạch"
 * "Bộ sơ cứu cá nhân" → "Bộ sơ cứu cá nhân" (Không có số lượng, giữ nguyên)
 * "Bộ sơ cứu cá nhân (đã mở)" → Giữ nguyên (Ngoặc không bắt đầu bằng số thì không bỏ)
 */
// Lượng từ cá thể: 1 cái = chỉ một cái, có thể lược bỏ. Lượng từ thuần túy (cái)(chiếc) cũng không có ý nghĩa
const COUNTING_CLASSIFIERS = 'cái chiếc mảnh miếng tờ tấm sợi cọng phần thanh quả hạt cành viên cặp đôi bát chén ly tách khay đĩa chậu thau xâu chuỗi bó bó';
// Đơn vị sức chứa/lô: 1 thùng = một thùng (bên trong có rất nhiều), không thể lược bỏ
// Đơn vị đo lường (cân/L/kg v.v.): có ý nghĩa đo lường thực tế, không thể lược bỏ

// ID Vật phẩm: 3 chữ số thêm số 0 ở bên trái, ví dụ 001, 002, ...
function padItemId(id) { return String(id).padStart(3, '0'); }

export function getItemBaseName(name) {
    return name
        .replace(/[\(（][\d][\d\.\/]*[a-zA-Z\u4e00-\u9fff]*[\)）]$/, '')  // Số + đơn vị bất kỳ
        .replace(new RegExp(`[\\(（][${COUNTING_CLASSIFIERS}][\\)）]$`), '')  // Lượng từ cá thể thuần túy (AI định dạng sai)
        .trim();
}

/** Tìm kiếm vật phẩm đã có theo tên cơ bản */
function findExistingItemByBaseName(stateItems, newName) {
    const newBase = getItemBaseName(newName);
    if (stateItems[newName]) return newName;
    for (const existingName of Object.keys(stateItems)) {
        if (getItemBaseName(existingName) === newBase) {
            return existingName;
        }
    }
    return null;
}

/** Trình quản lý Horae */
class HoraeManager {
    constructor() {
        this.context = null;
        this.settings = null;
    }

    /** Khởi tạo trình quản lý */
    init(context, settings) {
        this.context = context;
        this.settings = settings;
    }

    /** Lấy lịch sử trò chuyện hiện tại */
    getChat() {
        return this.context?.chat || [];
    }

    /** Lấy siêu dữ liệu tin nhắn */
    getMessageMeta(messageIndex) {
        const chat = this.getChat();
        if (messageIndex < 0 || messageIndex >= chat.length) return null;
        return chat[messageIndex].horae_meta || null;
    }

    /** Đặt siêu dữ liệu tin nhắn */
    setMessageMeta(messageIndex, meta) {
        const chat = this.getChat();
        if (messageIndex < 0 || messageIndex >= chat.length) return;
        chat[messageIndex].horae_meta = meta;
    }

    /** Tổng hợp tất cả siêu dữ liệu tin nhắn, lấy trạng thái mới nhất */
    getLatestState(skipLast = 0) {
        const chat = this.getChat();
        const state = createEmptyMeta();
        state._previousLocation = '';
        const end = Math.max(0, chat.length - skipLast);
        
        for (let i = 0; i < end; i++) {
            const meta = chat[i].horae_meta;
            if (!meta) continue;
            if (meta._skipHorae) continue;
            
            if (meta.timestamp?.story_date) {
                state.timestamp.story_date = meta.timestamp.story_date;
            }
            if (meta.timestamp?.story_time) {
                state.timestamp.story_time = meta.timestamp.story_time;
            }
            
            if (meta.scene?.location) {
                state._previousLocation = state.scene.location;
                state.scene.location = meta.scene.location;
            }
            if (meta.scene?.atmosphere) {
                state.scene.atmosphere = meta.scene.atmosphere;
            }
            if (meta.scene?.characters_present?.length > 0) {
                state.scene.characters_present = [...meta.scene.characters_present];
            }
            
            if (meta.costumes) {
                Object.assign(state.costumes, meta.costumes);
            }
            
            // Vật phẩm: Hợp nhất và cập nhật
            if (meta.items) {
                for (let [name, newInfo] of Object.entries(meta.items)) {
                    // Loại bỏ các đánh dấu số lượng không có ý nghĩa
                    // (1) Số 1 trần → Loại bỏ
                    name = name.replace(/[\(（]1[\)）]$/, '').trim();
                    // Lượng từ cá thể + Số 1 → Loại bỏ
                    name = name.replace(new RegExp(`[\\(（]1[${COUNTING_CLASSIFIERS}][\\)）]$`), '').trim();
                    // Lượng từ cá thể thuần túy → Loại bỏ
                    name = name.replace(new RegExp(`[\\(（][${COUNTING_CLASSIFIERS}][\\)）]$`), '').trim();
                    // Giữ lại đơn vị đo lường/sức chứa
                    
                    // Số lượng bằng 0 được coi là tiêu hao, tự động xóa
                    const zeroMatch = name.match(/[\(（]0[a-zA-Z\u4e00-\u9fff]*[\)）]$/);
                    if (zeroMatch) {
                        const baseName = getItemBaseName(name);
                        for (const itemName of Object.keys(state.items)) {
                            if (getItemBaseName(itemName).toLowerCase() === baseName.toLowerCase()) {
                                delete state.items[itemName];
                                console.log(`[Horae] Số lượng vật phẩm về 0, tự động xóa: ${itemName}`);
                            }
                        }
                        continue;
                    }
                    
                    // Phát hiện đánh dấu trạng thái tiêu hao, được coi là đã xóa
                    const consumedPatterns = /[\(（](đã tiêu hao|đã dùng hết|đã bị tiêu hủy|tiêu hao sạch|tiêu hao|dùng hết)[\)）]/;
                    const holderConsumed = /^(tiêu hao|đã tiêu hao|đã dùng hết|tiêu hao sạch|dùng hết|không)$/;
                    if (consumedPatterns.test(name) || holderConsumed.test(newInfo.holder || '')) {
                        const cleanName = name.replace(consumedPatterns, '').trim();
                        const baseName = getItemBaseName(cleanName || name);
                        for (const itemName of Object.keys(state.items)) {
                            if (getItemBaseName(itemName).toLowerCase() === baseName.toLowerCase()) {
                                delete state.items[itemName];
                                console.log(`[Horae] Vật phẩm đã tiêu hao, tự động xóa: ${itemName}`);
                            }
                        }
                        continue;
                    }
                    
                    // Tên cơ bản khớp với vật phẩm hiện có
                    const existingKey = findExistingItemByBaseName(state.items, name);
                    
                    if (existingKey) {
                        const existingItem = state.items[existingKey];
                        const mergedItem = { ...existingItem };
                        const locked = !!existingItem._locked;
                        if (!locked && newInfo.icon) mergedItem.icon = newInfo.icon;
                        if (!locked) {
                            const _impRank = { '': 0, '!': 1, '!!': 2 };
                            const _newR = _impRank[newInfo.importance] ?? 0;
                            const _oldR = _impRank[existingItem.importance] ?? 0;
                            mergedItem.importance = _newR >= _oldR ? (newInfo.importance || '') : (existingItem.importance || '');
                        }
                        if (newInfo.holder !== undefined) mergedItem.holder = newInfo.holder;
                        if (newInfo.location !== undefined) mergedItem.location = newInfo.location;
                        if (!locked && newInfo.description !== undefined && newInfo.description.trim()) {
                            mergedItem.description = newInfo.description;
                        }
                        if (!mergedItem.description) mergedItem.description = existingItem.description || '';
                        
                        if (existingKey !== name) {
                            delete state.items[existingKey];
                        }
                        state.items[name] = mergedItem;
                    } else {
                        state.items[name] = newInfo;
                    }
                }
            }
            
            // Xử lý vật phẩm đã xóa
            if (meta.deletedItems && meta.deletedItems.length > 0) {
                for (const deletedItem of meta.deletedItems) {
                    const deleteBase = getItemBaseName(deletedItem).toLowerCase();
                    for (const itemName of Object.keys(state.items)) {
                        const itemBase = getItemBaseName(itemName).toLowerCase();
                        if (itemName.toLowerCase() === deletedItem.toLowerCase() ||
                            itemBase === deleteBase) {
                            delete state.items[itemName];
                        }
                    }
                }
            }
            
            // Độ hảo cảm: Hỗ trợ giá trị tuyệt đối và giá trị tương đối
            if (meta.affection) {
                for (const [key, value] of Object.entries(meta.affection)) {
                    if (typeof value === 'object' && value !== null) {
                        // Định dạng mới: {type: 'absolute'|'relative', value: number|string}
                        if (value.type === 'absolute') {
                            state.affection[key] = value.value;
                        } else if (value.type === 'relative') {
                            const delta = parseFloat(value.value) || 0;
                            state.affection[key] = (state.affection[key] || 0) + delta;
                        }
                    } else {
                        // Tương thích định dạng cũ
                        const numValue = typeof value === 'number' ? value : parseFloat(value) || 0;
                        state.affection[key] = (state.affection[key] || 0) + numValue;
                    }
                }
            }
            
            // NPC: Hợp nhất từng trường, giữ nguyên _id
            if (meta.npcs) {
                // Các trường có thể cập nhật vs Các trường được bảo vệ
                const updatableFields = ['appearance', 'personality', 'relationship', 'age', 'job', 'note'];
                const protectedFields = ['gender', 'race', 'birthday'];
                for (const [name, newNpc] of Object.entries(meta.npcs)) {
                    const existing = state.npcs[name];
                    if (existing) {
                        for (const field of updatableFields) {
                            if (newNpc[field] !== undefined) existing[field] = newNpc[field];
                        }
                        // Khi tuổi thay đổi, ghi nhận ngày cốt truyện làm mốc chuẩn
                        if (newNpc.age !== undefined && newNpc.age !== '') {
                            if (!existing._ageRefDate) {
                                existing._ageRefDate = state.timestamp.story_date || '';
                            }
                            const oldAgeNum = parseInt(existing.age);
                            const newAgeNum = parseInt(newNpc.age);
                            if (!isNaN(oldAgeNum) && !isNaN(newAgeNum) && oldAgeNum !== newAgeNum) {
                                existing._ageRefDate = state.timestamp.story_date || '';
                            }
                        }
                        // Các trường được bảo vệ: Chỉ điền vào nếu chưa được thiết lập
                        for (const field of protectedFields) {
                            if (newNpc[field] !== undefined && !existing[field]) {
                                existing[field] = newNpc[field];
                            }
                        }
                        if (newNpc.last_seen) existing.last_seen = newNpc.last_seen;
                    } else {
                        state.npcs[name] = {
                            appearance: newNpc.appearance || '',
                            personality: newNpc.personality || '',
                            relationship: newNpc.relationship || '',
                            gender: newNpc.gender || '',
                            age: newNpc.age || '',
                            race: newNpc.race || '',
                            job: newNpc.job || '',
                            birthday: newNpc.birthday || '',
                            note: newNpc.note || '',
                            _ageRefDate: newNpc.age ? (state.timestamp.story_date || '') : '',
                            first_seen: newNpc.first_seen || new Date().toISOString(),
                            last_seen: newNpc.last_seen || new Date().toISOString()
                        };
                    }
                }
            }
            // Trạng thái cảm xúc (Ghi đè)
            if (meta.mood) {
                for (const [charName, emotion] of Object.entries(meta.mood)) {
                    state.mood[charName] = emotion;
                }
            }
        }
        
        // Lọc NPC đã bị người dùng xóa (Chống hoàn tác)
        const deletedNpcs = chat[0]?.horae_meta?._deletedNpcs;
        if (deletedNpcs?.length) {
            for (const name of deletedNpcs) {
                delete state.npcs[name];
                delete state.affection[name];
                delete state.costumes[name];
                delete state.mood[name];
                if (state.scene.characters_present) {
                    state.scene.characters_present = state.scene.characters_present.filter(c => c !== name);
                }
            }
        }
        
        // Phân bổ ID cho các vật phẩm không có ID
        let maxId = 0;
        for (const info of Object.values(state.items)) {
            if (info._id) {
                const num = parseInt(info._id, 10);
                if (num > maxId) maxId = num;
            }
        }
        for (const info of Object.values(state.items)) {
            if (!info._id) {
                maxId++;
                info._id = padItemId(maxId);
            }
        }
        
        // Phân bổ ID cho các NPC không có ID
        let maxNpcId = 0;
        for (const info of Object.values(state.npcs)) {
            if (info._id) {
                const num = parseInt(info._id, 10);
                if (num > maxNpcId) maxNpcId = num;
            }
        }
        for (const info of Object.values(state.npcs)) {
            if (!info._id) {
                maxNpcId++;
                info._id = padItemId(maxNpcId);
            }
        }
        
        return state;
    }

    /** Phân tích cú pháp chuỗi ngày sinh, hỗ trợ yyyy-mm-dd / yyyy/mm/dd / mm-dd / mm/dd */
    _parseBirthday(str) {
        if (!str) return null;
        let m = str.match(/(\d{2,4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
        if (m) return { year: parseInt(m[1]), month: parseInt(m[2]), day: parseInt(m[3]) };
        m = str.match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
        if (m) return { year: null, month: parseInt(m[1]), day: parseInt(m[2]) };
        return null;
    }

    /** Dựa vào sự trôi qua của thời gian trong cốt truyện để tính toán tuổi hiện tại của NPC (Ưu tiên dùng ngày sinh để tính chính xác) */
    calcCurrentAge(npcInfo, currentStoryDate) {
        const original = npcInfo.age || '';
        if (!original || !currentStoryDate) {
            return { display: original, original, changed: false };
        }

        const ageNum = parseInt(original);
        if (isNaN(ageNum)) {
            return { display: original, original, changed: false };
        }

        const curParsed = parseStoryDate(currentStoryDate);
        if (!curParsed || curParsed.type !== 'standard' || !curParsed.year) {
            return { display: original, original, changed: false };
        }

        const bdParsed = this._parseBirthday(npcInfo.birthday);

        // ── Có ngày sinh đầy đủ (Gồm cả năm): Tính toán chính xác ──
        if (bdParsed?.year) {
            let age = curParsed.year - bdParsed.year;
            if (bdParsed.month && curParsed.month) {
                if (curParsed.month < bdParsed.month ||
                    (curParsed.month === bdParsed.month && (curParsed.day || 1) < (bdParsed.day || 1))) {
                    age -= 1;
                }
            }
            age = Math.max(0, age);
            return { display: String(age), original, changed: age !== ageNum };
        }

        // Hai trường hợp dưới đây đều cần dùng đến _ageRefDate
        const refDate = npcInfo._ageRefDate || '';
        if (!refDate) return { display: original, original, changed: false };

        const refParsed = parseStoryDate(refDate);
        if (!refParsed || refParsed.type !== 'standard' || !refParsed.year) {
            return { display: original, original, changed: false };
        }

        // ── Chỉ có tháng, ngày sinh: Dùng refDate + age để suy ra năm sinh, sau đó tính toán chính xác ──
        if (bdParsed?.month) {
            let birthYear = refParsed.year - ageNum;
            if (refParsed.month) {
                const refBeforeBd = refParsed.month < bdParsed.month ||
                    (refParsed.month === bdParsed.month && (refParsed.day || 1) < (bdParsed.day || 1));
                if (refBeforeBd) birthYear -= 1;
            }
            let currentAge = curParsed.year - birthYear;
            if (curParsed.month) {
                const curBeforeBd = curParsed.month < bdParsed.month ||
                    (curParsed.month === bdParsed.month && (curParsed.day || 1) < (bdParsed.day || 1));
                if (curBeforeBd) currentAge -= 1;
            }
            if (currentAge <= ageNum) return { display: original, original, changed: false };
            return { display: String(currentAge), original, changed: true };
        }

        // ── Không có ngày sinh: Trở lại logic cũ ──
        let yearDiff = curParsed.year - refParsed.year;
        if (refParsed.month && curParsed.month) {
            if (curParsed.month < refParsed.month ||
                (curParsed.month === refParsed.month && (curParsed.day || 1) < (refParsed.day || 1))) {
                yearDiff -= 1;
            }
        }
        if (yearDiff <= 0) return { display: original, original, changed: false };
        return { display: String(ageNum + yearDiff), original, changed: true };
    }

    /** Tìm kiếm vật phẩm theo ID */
    findItemById(items, id) {
        const normalizedId = id.replace(/^#/, '').trim();
        for (const [name, info] of Object.entries(items)) {
            if (info._id === normalizedId || info._id === padItemId(parseInt(normalizedId, 10))) {
                return [name, info];
            }
        }
        return null;
    }

    /** Lấy danh sách sự kiện (limit = 0 nghĩa là không giới hạn số lượng) */
    getEvents(limit = 0, filterLevel = 'all', skipLast = 0) {
        const chat = this.getChat();
        const end = Math.max(0, chat.length - skipLast);
        const events = [];
        
        for (let i = 0; i < end; i++) {
            const meta = chat[i].horae_meta;
            if (meta?._skipHorae) continue;
            
            const metaEvents = meta?.events || (meta?.event ? [meta.event] : []);
            
            for (let j = 0; j < metaEvents.length; j++) {
                const evt = metaEvents[j];
                if (!evt?.summary) continue;
                
                if (filterLevel !== 'all' && evt.level !== filterLevel) {
                    continue;
                }
                
                events.push({
                    messageIndex: i,
                    eventIndex: j,
                    timestamp: meta.timestamp,
                    event: evt
                });
                
                if (limit > 0 && events.length >= limit) break;
            }
            if (limit > 0 && events.length >= limit) break;
        }
        
        return events;
    }

    /** Lấy danh sách các sự kiện quan trọng (Tương thích với các truy xuất cũ) */
    getImportantEvents(limit = 0) {
        return this.getEvents(limit, 'all');
    }

    /** Tạo nội dung ngữ cảnh rút gọn để tiêm vào (skipLast: khi lướt (swipe) sẽ bỏ qua N tin nhắn cuối) */
    generateCompactPrompt(skipLast = 0) {
        const state = this.getLatestState(skipLast);
        const lines = [];
        
        // Tiêu đề của ảnh chụp trạng thái
        lines.push('[Ảnh chụp trạng thái hiện tại —— So chiếu với tình tiết trong lượt này, chỉ in ra các trường có thay đổi thực tế vào trong <horae>]');
        
        const sendTimeline = this.settings?.sendTimeline !== false;
        const sendCharacters = this.settings?.sendCharacters !== false;
        const sendItems = this.settings?.sendItems !== false;
        
        // Thời gian
        if (state.timestamp.story_date) {
            const fullDateTime = formatFullDateTime(state.timestamp.story_date, state.timestamp.story_time);
            lines.push(`[Thời gian|${fullDateTime}]`);
            
            // Tham chiếu thời gian
            if (sendTimeline) {
                const timeRef = generateTimeReference(state.timestamp.story_date);
                if (timeRef && timeRef.type === 'standard') {
                    // Lịch tiêu chuẩn
                    lines.push(`[Tham chiếu thời gian|Hôm qua=${timeRef.yesterday}|Hôm kia=${timeRef.dayBefore}|3 ngày trước=${timeRef.threeDaysAgo}]`);
                } else if (timeRef && timeRef.type === 'fantasy') {
                    // Lịch giả tưởng
                    lines.push(`[Tham chiếu thời gian|Chế độ lịch giả tưởng, xem các dấu mốc thời gian tương đối trong quỹ đạo cốt truyện]`);
                }
            }
        }
        
        // Bối cảnh
        if (state.scene.location) {
            let sceneStr = `[Bối cảnh|${state.scene.location}`;
            if (state.scene.atmosphere) {
                sceneStr += `|${state.scene.atmosphere}`;
            }
            sceneStr += ']';
            lines.push(sceneStr);

            if (this.settings?.sendLocationMemory) {
                const locMem = this.getLocationMemory();
                const loc = state.scene.location;
                const entry = this._findLocationMemory(loc, locMem, state._previousLocation);
                if (entry?.desc) {
                    lines.push(`[Ký ức bối cảnh|${entry.desc}]`);
                }
                // Đi kèm mô tả về địa điểm cấp độ cha (ví dụ "Quán rượu·Đại sảnh" → Gửi kèm mô tả về "Quán rượu")
                const sepMatch = loc.match(/[·・\-\/\|]/);
                if (sepMatch) {
                    const parent = loc.substring(0, sepMatch.index).trim();
                    if (parent && locMem[parent] && locMem[parent].desc && parent !== entry?._matchedName) {
                        lines.push(`[Ký ức bối cảnh:${parent}|${locMem[parent].desc}]`);
                    }
                }
            }
        }
        
        // Các nhân vật hiện diện và trang phục
        if (sendCharacters) {
            const presentChars = state.scene.characters_present || [];
            
            if (presentChars.length > 0) {
                const charStrs = [];
                for (const char of presentChars) {
                    // Khớp mờ trang phục
                    const costumeKey = Object.keys(state.costumes || {}).find(
                        k => k === char || k.includes(char) || char.includes(k)
                    );
                    if (costumeKey && state.costumes[costumeKey]) {
                        charStrs.push(`${char}(${state.costumes[costumeKey]})`);
                    } else {
                        charStrs.push(char);
                    }
                }
                lines.push(`[Có mặt|${charStrs.join('|')}]`);
            }
            
            // Trạng thái cảm xúc (Chỉ áp dụng cho nhân vật có mặt, phản ứng theo diễn biến)
            if (this.settings?.sendMood) {
                const moodEntries = [];
                for (const char of presentChars) {
                    if (state.mood[char]) {
                        moodEntries.push(`${char}:${state.mood[char]}`);
                    }
                }
                if (moodEntries.length > 0) {
                    lines.push(`[Cảm xúc|${moodEntries.join('|')}]`);
                }
            }
            
            // Mạng lưới quan hệ (Đọc từ chat[0], chỉ các mối quan hệ liên quan đến các nhân vật đang có mặt, không tốn token kết xuất của AI)
            if (this.settings?.sendRelationships) {
                const rels = this.getRelationshipsForCharacters(presentChars);
                if (rels.length > 0) {
                    lines.push('\n[Mạng lưới quan hệ]');
                    for (const r of rels) {
                        const noteStr = r.note ? `(${r.note})` : '';
                        lines.push(`${r.from}→${r.to}: ${r.type}${noteStr}`);
                    }
                }
            }
        }
        
        // Vật phẩm (Các vật phẩm đang được trang bị không hiện ở đây để khỏi bị lặp lại)
        if (sendItems) {
            const items = Object.entries(state.items);
            // Tổng hợp các tên trang bị đã mặc thành một nhóm
            const equippedNames = new Set();
            if (this.settings?.rpgMode && !!this.settings.sendRpgEquipment) {
                const rpgData = this.getRpgStateAt(skipLast);
                for (const [, slots] of Object.entries(rpgData.equipment || {})) {
                    for (const [, eqItems] of Object.entries(slots)) {
                        for (const eq of eqItems) equippedNames.add(eq.name);
                    }
                }
            }
            const unequipped = items.filter(([name]) => !equippedNames.has(name));
            if (unequipped.length > 0) {
                lines.push('\n[Danh sách vật phẩm]');
                for (const [name, info] of unequipped) {
                    const id = info._id || '???';
                    const icon = info.icon || '';
                    const imp = info.importance === '!!' ? 'Quan trọng (Chìa khóa)' : info.importance === '!' ? 'Quan trọng' : '';
                    const desc = info.description ? ` | ${info.description}` : '';
                    const holder = info.holder || '';
                    const loc = info.location ? `@${info.location}` : '';
                    const impTag = imp ? `[${imp}]` : '';
                    lines.push(`#${id} ${icon}${name}${impTag}${desc} = ${holder}${loc}`);
                }
            } else {
                lines.push('\n[Danh sách vật phẩm] (Trống)');
            }
        }
        
        // Mức độ hảo cảm
        if (sendCharacters) {
            const affections = Object.entries(state.affection).filter(([_, v]) => v !== 0);
            if (affections.length > 0) {
                const affStr = affections.map(([k, v]) => `${k}:${v > 0 ? '+' : ''}${v}`).join('|');
                lines.push(`[Hảo cảm|${affStr}]`);
            }
            
            // Dữ liệu NPC
            const npcs = Object.entries(state.npcs);
            if (npcs.length > 0) {
                lines.push('\n[NPC đã biết]');
                for (const [name, info] of npcs) {
                    const id = info._id || '?';
                    const app = info.appearance || '';
                    const per = info.personality || '';
                    const rel = info.relationship || '';
                    // Chủ thể: N(Số thứ tự) Tên｜Ngoại hình=Tính cách@Quan hệ
                    let npcStr = `N${id} ${name}`;
                    if (app || per || rel) {
                        npcStr += `｜${app}=${per}@${rel}`;
                    }
                    // Các mục mở rộng
                    const extras = [];
                    if (info._aliases?.length) extras.push(`Tên từng gọi:${info._aliases.join('/')}`);
                    if (info.gender) extras.push(`Giới tính:${info.gender}`);
                    if (info.age) {
                        const ageResult = this.calcCurrentAge(info, state.timestamp.story_date);
                        extras.push(`Tuổi:${ageResult.display}`);
                    }
                    if (info.race) extras.push(`Chủng tộc:${info.race}`);
                    if (info.job) extras.push(`Nghề nghiệp:${info.job}`);
                    if (info.birthday) extras.push(`Ngày sinh:${info.birthday}`);
                    if (info.note) extras.push(`Bổ sung:${info.note}`);
                    if (extras.length > 0) npcStr += `~${extras.join('~')}`;
                    lines.push(npcStr);
                }
            }
        }
        
        // Những việc cần hoàn thành
        const chatForAgenda = this.getChat();
        const allAgendaItems = [];
        const seenTexts = new Set();
        const deletedTexts = new Set(chatForAgenda?.[0]?.horae_meta?._deletedAgendaTexts || []);
        const userAgenda = chatForAgenda?.[0]?.horae_meta?.agenda || [];
        for (const item of userAgenda) {
            if (item._deleted || deletedTexts.has(item.text)) continue;
            if (!seenTexts.has(item.text)) {
                allAgendaItems.push(item);
                seenTexts.add(item.text);
            }
        }
        // AI viết (nếu sử dụng vuốt (swipe), bỏ qua đoạn tin cuối)
        const agendaEnd = Math.max(0, (chatForAgenda?.length || 0) - skipLast);
        if (chatForAgenda) {
            for (let i = 1; i < agendaEnd; i++) {
                const msgAgenda = chatForAgenda[i].horae_meta?.agenda;
                if (msgAgenda?.length > 0) {
                    for (const item of msgAgenda) {
                        if (item._deleted || deletedTexts.has(item.text)) continue;
                        if (!seenTexts.has(item.text)) {
                            allAgendaItems.push(item);
                            seenTexts.add(item.text);
                        }
                    }
                }
            }
        }
        const activeAgenda = allAgendaItems.filter(a => !a.done);
        if (activeAgenda.length > 0) {
            lines.push('\n[Việc cần làm]');
            for (const item of activeAgenda) {
                const datePrefix = item.date ? `${item.date} ` : '';
                lines.push(`· ${datePrefix}${item.text}`);
            }
        }
        
        // Trạng thái RPG (Khi được kích hoạt, chỉ áp dụng cho những nhân vật hiện diện)
        if (this.settings?.rpgMode) {
            const rpg = this.getRpgStateAt(skipLast);
            const sendBars = this.settings?.sendRpgBars !== false;
            const sendSkills = this.settings?.sendRpgSkills !== false;

            // Gán tên cho các thanh thuộc tính
            const _barCfg = this.settings?.rpgBarConfig || [];
            const _barNames = {};
            for (const b of _barCfg) _barNames[b.key] = b.name;

            // Phân loại số liệu RPG dựa theo những nhân vật đang có mặt (sẽ trả về toàn bộ nếu không có dữ liệu hiện trường)
            const presentChars = state.scene.characters_present || [];
            const userName = this.context?.name1 || '';
            const _cUoB = !!this.settings?.rpgBarsUserOnly;
            const _cUoS = !!this.settings?.rpgSkillsUserOnly;
            const _cUoA = !!this.settings?.rpgAttrsUserOnly;
            const _cUoE = !!this.settings?.rpgEquipmentUserOnly;
            const _cUoR = !!this.settings?.rpgReputationUserOnly;
            const _cUoL = !!this.settings?.rpgLevelUserOnly;
            const _cUoC = !!this.settings?.rpgCurrencyUserOnly;
            const allRpgNames = new Set([
                ...Object.keys(rpg.bars), ...Object.keys(rpg.status || {}),
                ...Object.keys(rpg.skills), ...Object.keys(rpg.attributes || {}),
                ...Object.keys(rpg.reputation || {}), ...Object.keys(rpg.equipment || {}),
                ...Object.keys(rpg.levels || {}), ...Object.keys(rpg.xp || {}),
                ...Object.keys(rpg.currency || {}),
            ]);
            const rpgAllowed = new Set();
            if (presentChars.length > 0) {
                for (const p of presentChars) {
                    const n = p.trim();
                    if (!n) continue;
                    if (allRpgNames.has(n)) { rpgAllowed.add(n); continue; }
                    if (n === userName && allRpgNames.has(userName)) { rpgAllowed.add(userName); continue; }
                    for (const rn of allRpgNames) {
                        if (rn.includes(n) || n.includes(rn)) { rpgAllowed.add(rn); break; }
                    }
                }
            }
            const filterRpg = rpgAllowed.size > 0;
            // Xây dựng dòng văn bản không mang tiền tố khi chế độ userOnly (chỉ cho phép dùng trên người dùng) hoạt động
            const _ctxPre = (name, isUo) => {
                if (isUo) return '';
                const npc = state.npcs[name];
                return npc?._id ? `N${npc._id} ${name}: ` : `${name}: `;
            };

            if (sendBars && Object.keys(rpg.bars).length > 0) {
                lines.push('\n[Trạng thái RPG]');
                for (const [name, bars] of Object.entries(rpg.bars)) {
                    if (_cUoB && name !== userName) continue;
                    if (filterRpg && !rpgAllowed.has(name)) continue;
                    const parts = [];
                    for (const [type, val] of Object.entries(bars)) {
                        const label = val[2] || _barNames[type] || type.toUpperCase();
                        parts.push(`${label} ${val[0]}/${val[1]}`);
                    }
                    const sts = rpg.status?.[name];
                    if (sts?.length > 0) parts.push(`Trạng thái:${sts.join('/')}`);
                    if (parts.length > 0) lines.push(`${_ctxPre(name, _cUoB)}${parts.join(' | ')}`);
                }
                for (const [name, effects] of Object.entries(rpg.status || {})) {
                    if (rpg.bars[name] || effects.length === 0) continue;
                    if (_cUoB && name !== userName) continue;
                    if (filterRpg && !rpgAllowed.has(name)) continue;
                    lines.push(`${_ctxPre(name, _cUoB)}Trạng thái:${effects.join('/')}`);
                }
            }

            if (sendSkills && Object.keys(rpg.skills).length > 0) {
                const hasAny = Object.entries(rpg.skills).some(([n, arr]) =>
                    arr?.length > 0 && (!_cUoS || n === userName) && (!filterRpg || rpgAllowed.has(n)));
                if (hasAny) {
                    lines.push('\n[Danh sách kỹ năng]');
                    for (const [name, skills] of Object.entries(rpg.skills)) {
                        if (!skills?.length) continue;
                        if (_cUoS && name !== userName) continue;
                        if (filterRpg && !rpgAllowed.has(name)) continue;
                        if (!_cUoS) {
                            const npc = state.npcs[name];
                            const pre = npc?._id ? `N${npc._id} ` : '';
                            lines.push(`${pre}${name}:`);
                        }
                        for (const sk of skills) {
                            const lv = sk.level ? ` ${sk.level}` : '';
                            const desc = sk.desc ? ` | ${sk.desc}` : '';
                            lines.push(`  ${sk.name}${lv}${desc}`);
                        }
                    }
                }
            }

            const sendAttrs = this.settings?.sendRpgAttributes !== false;
            const attrCfg = this.settings?.rpgAttributeConfig || [];
            if (sendAttrs && attrCfg.length > 0 && Object.keys(rpg.attributes || {}).length > 0) {
                lines.push('\n[Thuộc tính đa chiều]');
                for (const [name, vals] of Object.entries(rpg.attributes)) {
                    if (_cUoA && name !== userName) continue;
                    if (filterRpg && !rpgAllowed.has(name)) continue;
                    const parts = attrCfg.map(a => `${a.name}${vals[a.key] ?? '?'}`);
                    lines.push(`${_ctxPre(name, _cUoA)}${parts.join(' | ')}`);
                }
            }

            // Trang bị (Các khoang chứa đồ (slot) được tạo riêng dựa theo nhân vật, gồm mô tả vật phẩm một cách đầy đủ để dùng ít token hơn)
            const sendEq = !!this.settings?.sendRpgEquipment;
            const eqPerChar = (rpg.equipmentConfig?.perChar) || {};
            const storedEq = this.getChat()?.[0]?.horae_meta?.rpg?.equipment || {};
            if (sendEq && Object.keys(rpg.equipment || {}).length > 0) {
                let hasEqData = false;
                for (const [name, slots] of Object.entries(rpg.equipment)) {
                    if (_cUoE && name !== userName) continue;
                    if (filterRpg && !rpgAllowed.has(name)) continue;
                    const ownerCfg = eqPerChar[name];
                    const validEqSlots = (ownerCfg && Array.isArray(ownerCfg.slots))
                        ? new Set(ownerCfg.slots.map(s => s.name)) : null;
                    const deletedEqSlots = ownerCfg ? new Set(ownerCfg._deletedSlots || []) : new Set();
                    const parts = [];
                    for (const [slotName, items] of Object.entries(slots)) {
                        if (deletedEqSlots.has(slotName)) continue;
                        if (validEqSlots && validEqSlots.size > 0 && !validEqSlots.has(slotName)) continue;
                        for (const item of items) {
                            const attrStr = Object.entries(item.attrs || {}).map(([k, v]) => `${k}${v >= 0 ? '+' : ''}${v}`).join(',');
                            const stored = storedEq[name]?.[slotName]?.find(e => e.name === item.name);
                            const desc = stored?._itemMeta?.description || '';
                            const descPart = desc ? ` "${desc}"` : '';
                            parts.push(`[${slotName}]${item.name}${attrStr ? `{${attrStr}}` : ''}${descPart}`);
                        }
                    }
                    if (parts.length > 0) {
                        if (!hasEqData) { lines.push('\n[Trang bị]'); hasEqData = true; }
                        lines.push(`${_ctxPre(name, _cUoE)}${parts.join(' | ')}`);
                    }
                }
            }

            // Độ uy tín (Cần mở công tắc)
            const sendRep = !!this.settings?.sendRpgReputation;
            const repConfig = rpg.reputationConfig || { categories: [] };
            if (sendRep && repConfig.categories.length > 0 && Object.keys(rpg.reputation || {}).length > 0) {
                const validRepNames = new Set(repConfig.categories.map(c => c.name));
                const deletedRepNames = new Set(repConfig._deletedCategories || []);
                let hasRepData = false;
                for (const [name, cats] of Object.entries(rpg.reputation)) {
                    if (_cUoR && name !== userName) continue;
                    if (filterRpg && !rpgAllowed.has(name)) continue;
                    const parts = [];
                    for (const [catName, data] of Object.entries(cats)) {
                        if (!validRepNames.has(catName) || deletedRepNames.has(catName)) continue;
                        parts.push(`${catName}:${data.value}`);
                    }
                    if (parts.length > 0) {
                        if (!hasRepData) { lines.push('\n[Danh tiếng]'); hasRepData = true; }
                        lines.push(`${_ctxPre(name, _cUoR)}${parts.join(' | ')}`);
                    }
                }
            }

            // Cấp bậc
            const sendLvl = !!this.settings?.sendRpgLevel;
            if (sendLvl && (Object.keys(rpg.levels || {}).length > 0 || Object.keys(rpg.xp || {}).length > 0)) {
                const allLvlNames = new Set([...Object.keys(rpg.levels || {}), ...Object.keys(rpg.xp || {})]);
                let hasLvlData = false;
                for (const name of allLvlNames) {
                    if (_cUoL && name !== userName) continue;
                    if (filterRpg && !rpgAllowed.has(name)) continue;
                    const lv = rpg.levels?.[name];
                    const xp = rpg.xp?.[name];
                    if (lv == null && !xp) continue;
                    if (!hasLvlData) { lines.push('\n[Cấp độ]'); hasLvlData = true; }
                    let lvStr = lv != null ? `Lv.${lv}` : '';
                    if (xp) lvStr += ` (Điểm kinh nghiệm: ${xp[0]}/${xp[1]})`;
                    lines.push(`${_ctxPre(name, _cUoL)}${lvStr.trim()}`);
                }
            }

            // Loại tiền
            const sendCur = !!this.settings?.sendRpgCurrency;
            const curConfig = rpg.currencyConfig || { denominations: [] };
            if (sendCur && curConfig.denominations.length > 0 && Object.keys(rpg.currency || {}).length > 0) {
                let hasCurData = false;
                for (const [name, coins] of Object.entries(rpg.currency)) {
                    if (_cUoC && name !== userName) continue;
                    if (filterRpg && !rpgAllowed.has(name)) continue;
                    const parts = [];
                    for (const d of curConfig.denominations) {
                        const val = coins[d.name];
                        if (val != null) parts.push(`${d.name}×${val}`);
                    }
                    if (parts.length > 0) {
                        if (!hasCurData) { lines.push('\n[Hệ thống tiền tệ]'); hasCurData = true; }
                        lines.push(`${_ctxPre(name, _cUoC)}${parts.join(', ')}`);
                    }
                }
            }

            // Căn cứ
            if (!!this.settings?.sendRpgStronghold) {
                const shNodes = rpg.strongholds || [];
                if (shNodes.length > 0) {
                    lines.push('\n[Cứ điểm]');
                    function _shTreeStr(nodes, parentId, indent) {
                        const children = nodes.filter(n => (n.parent || null) === parentId);
                        let str = '';
                        for (const c of children) {
                            const lvStr = c.level != null ? ` Lv.${c.level}` : '';
                            str += `${'  '.repeat(indent)}${c.name}${lvStr}`;
                            if (c.desc) str += ` — ${c.desc}`;
                            str += '\n';
                            str += _shTreeStr(nodes, c.id, indent + 1);
                        }
                        return str;
                    }
                    lines.push(_shTreeStr(shNodes, null, 0).trimEnd());
                }
            }
        }
        
        // Quỹ đạo cốt truyện
        if (sendTimeline) {
            const allEvents = this.getEvents(0, 'all', skipLast);
            // Lọc bỏ các sự kiện gốc bị bao phủ bởi tóm tắt đang hoạt động (_compressedBy và tóm tắt là active)
            const timelineChat = this.getChat();
            const autoSums = timelineChat?.[0]?.horae_meta?.autoSummaries || [];
            const activeSumIds = new Set(autoSums.filter(s => s.active).map(s => s.id));
            // Các sự kiện bị nén bởi tóm tắt đang hoạt động sẽ không được gửi; khi tóm tắt là inactive thì sự kiện _summaryId tương ứng của nó sẽ không được gửi
            const events = allEvents.filter(e => {
                if (e.event?._compressedBy && activeSumIds.has(e.event._compressedBy)) return false;
                if (e.event?._summaryId && !activeSumIds.has(e.event._summaryId)) return false;
                return true;
            });
            if (events.length > 0) {
                lines.push('\n[Quỹ đạo cốt truyện]');
                
                const currentDate = state.timestamp?.story_date || '';
                
                const getLevelMark = (level) => {
                    if (level === '关键' || level === 'Quan trọng (Chìa khóa)') return '★';
                    if (level === '重要' || level === 'Quan trọng') return '●';
                    return '○';
                };
                
                const getRelativeDesc = (eventDate) => {
                    if (!eventDate || !currentDate) return '';
                    const result = calculateDetailedRelativeTime(eventDate, currentDate);
                    if (result.days === null || result.days === undefined) return '';
                    
                    const { days, fromDate, toDate } = result;
                    
                    if (days === 0) return '(Hôm nay)';
                    if (days === 1) return '(Hôm qua)';
                    if (days === 2) return '(Hôm kia)';
                    if (days === 3) return '(Ba ngày trước)';
                    if (days === -1) return '(Ngày mai)';
                    if (days === -2) return '(Ngày kia)';
                    if (days === -3) return '(Ba ngày sau)';
                    
                    if (days >= 4 && days <= 13 && fromDate) {
                        const WEEKDAY_NAMES = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
                        const weekday = fromDate.getDay();
                        return `(${WEEKDAY_NAMES[weekday]} tuần trước)`;
                    }
                    
                    if (days >= 20 && days < 60 && fromDate && toDate) {
                        const fromMonth = fromDate.getMonth();
                        const toMonth = toDate.getMonth();
                        if (fromMonth !== toMonth) {
                            return `(Ngày ${fromDate.getDate()} tháng trước)`;
                        }
                    }
                    
                    if (days >= 300 && fromDate && toDate) {
                        const fromYear = fromDate.getFullYear();
                        const toYear = toDate.getFullYear();
                        if (fromYear < toYear) {
                            const fromMonth = fromDate.getMonth() + 1;
                            return `(Tháng ${fromMonth} năm ngoái)`;
                        }
                    }
                    
                    if (days > 0 && days < 30) return `(${days} ngày trước)`;
                    if (days > 0) return `(${Math.round(days / 30)} tháng trước)`;
                    if (days === -999 || days === -998 || days === -997) return '';
                    return '';
                };
                
                const sortedEvents = [...events].sort((a, b) => {
                    return (a.messageIndex || 0) - (b.messageIndex || 0);
                });
                
                const criticalAndImportant = sortedEvents.filter(e => 
                    e.event?.level === '关键' || e.event?.level === 'Quan trọng (Chìa khóa)' || e.event?.level === '重要' || e.event?.level === 'Quan trọng' || e.event?.level === '摘要' || e.event?.level === 'Tóm tắt' || e.event?.isSummary
                );
                const contextDepth = this.settings?.contextDepth ?? 15;
                const normalAll = sortedEvents.filter(e => 
                    (e.event?.level === '一般' || e.event?.level === 'Bình thường' || !e.event?.level) && !e.event?.isSummary
                );
                const normalEvents = contextDepth === 0 ? [] : normalAll.slice(-contextDepth);
                
                const allToShow = [...criticalAndImportant, ...normalEvents]
                    .sort((a, b) => (a.messageIndex || 0) - (b.messageIndex || 0));
                
                // Dựng sẵn ánh xạ summaryId→Phạm vi ngày, để sự kiện tóm tắt mang theo khoảng thời gian
                const _sumDateRanges = {};
                for (const s of autoSums) {
                    if (!s.active || !s.originalEvents?.length) continue;
                    const dates = s.originalEvents.map(oe => oe.timestamp?.story_date).filter(Boolean);
                    if (dates.length > 0) {
                        const first = dates[0], last = dates[dates.length - 1];
                        _sumDateRanges[s.id] = first === last ? first : `${first}~${last}`;
                    }
                }

                for (const e of allToShow) {
                    const isSummary = e.event?.isSummary || e.event?.level === '摘要' || e.event?.level === 'Tóm tắt';
                    if (isSummary) {
                        const dateRange = e.event?._summaryId ? _sumDateRanges[e.event._summaryId] : '';
                        const dateTag = dateRange ? `·${dateRange}` : '';
                        const relTag = dateRange ? getRelativeDesc(dateRange.split('~')[0]) : '';
                        lines.push(`📋 [Tóm tắt${dateTag}]${relTag}: ${e.event.summary}`);
                    } else {
                        const mark = getLevelMark(e.event?.level);
                        const date = e.timestamp?.story_date || '?';
                        const time = e.timestamp?.story_time || '';
                        const timeStr = time ? `${date} ${time}` : date;
                        const relativeDesc = getRelativeDesc(e.timestamp?.story_date);
                        const msgNum = e.messageIndex !== undefined ? `#${e.messageIndex}` : '';
                        lines.push(`${mark} ${msgNum} ${timeStr}${relativeDesc}: ${e.event.summary}`);
                    }
                }
            }
        }
        
        // Dữ liệu bảng biểu tùy chỉnh (Hợp nhất toàn cục và cục bộ)
        const chat = this.getChat();
        const firstMsg = chat?.[0];
        const localTables = firstMsg?.horae_meta?.customTables || [];
        const resolvedGlobal = this._getResolvedGlobalTables();
        const allTables = [...resolvedGlobal, ...localTables];
        for (const table of allTables) {
            const rows = table.rows || 2;
            const cols = table.cols || 2;
            const data = table.data || {};
            
            // Có nội dung hoặc có hướng dẫn điền bảng mới xuất ra
            const hasContent = Object.values(data).some(v => v && v.trim());
            const hasPrompt = table.prompt && table.prompt.trim();
            if (!hasContent && !hasPrompt) continue;
            
            const tableName = table.name || 'Bảng biểu tùy chỉnh';
            lines.push(`\n[${tableName}](${rows - 1} hàng × ${cols - 1} cột)`);
            
            if (table.prompt && table.prompt.trim()) {
                lines.push(`(Yêu cầu điền: ${table.prompt.trim()})`);
            }
            
            // Kiểm tra hàng cuối cùng có nội dung (bao gồm cột tiêu đề hàng)
            let lastDataRow = 0;
            for (let r = rows - 1; r >= 1; r--) {
                for (let c = 0; c < cols; c++) {
                    if (data[`${r}-${c}`] && data[`${r}-${c}`].trim()) {
                        lastDataRow = r;
                        break;
                    }
                }
                if (lastDataRow > 0) break;
            }
            if (lastDataRow === 0) lastDataRow = 1;
            
            const lockedRows = new Set(table.lockedRows || []);
            const lockedCols = new Set(table.lockedCols || []);
            const lockedCells = new Set(table.lockedCells || []);

            // Xuất hàng tiêu đề (kèm chú thích tọa độ)
            const headerRow = [];
            for (let c = 0; c < cols; c++) {
                const label = data[`0-${c}`] || (c === 0 ? 'Tiêu đề' : `Cột ${c}`);
                const coord = `[0,${c}]`;
                headerRow.push(lockedCols.has(c) ? `${coord}${label}🔒` : `${coord}${label}`);
            }
            lines.push(headerRow.join(' | '));

            // Xuất hàng dữ liệu (kèm chú thích tọa độ)
            for (let r = 1; r <= lastDataRow; r++) {
                const rowData = [];
                for (let c = 0; c < cols; c++) {
                    const coord = `[${r},${c}]`;
                    if (c === 0) {
                        const label = data[`${r}-0`] || `${r}`;
                        rowData.push(lockedRows.has(r) ? `${coord}${label}🔒` : `${coord}${label}`);
                    } else {
                        const val = data[`${r}-${c}`] || '';
                        rowData.push(lockedCells.has(`${r}-${c}`) ? `${coord}${val}🔒` : `${coord}${val}`);
                    }
                }
                lines.push(rowData.join(' | '));
            }
            
            // Ghi chú các hàng trống ở cuối bị tỉnh lược
            if (lastDataRow < rows - 1) {
                lines.push(`(Tổng cộng ${rows - 1} hàng, hàng ${lastDataRow + 1}-${rows - 1} tạm thời chưa có dữ liệu)`);
            }

            // Nhắc nhở các cột dữ liệu hoàn toàn trống
            const emptyCols = [];
            for (let c = 1; c < cols; c++) {
                let colHasData = false;
                for (let r = 1; r < rows; r++) {
                    if (data[`${r}-${c}`] && data[`${r}-${c}`].trim()) { colHasData = true; break; }
                }
                if (!colHasData) emptyCols.push(c);
            }
            if (emptyCols.length > 0) {
                const emptyColNames = emptyCols.map(c => data[`0-${c}`] || `Cột ${c}`);
                lines.push(`(${emptyColNames.join(', ')}：Tạm thời chưa có dữ liệu, nếu trong cốt truyện đã có thông tin liên quan vui lòng điền vào)`);
            }
        }
        
        return lines.join('\n');
    }

    /** Lấy mô tả cấp độ độ hảo cảm */
    getAffectionLevel(value) {
        if (value >= 80) return 'Yêu say đắm';
        if (value >= 60) return 'Thân mật';
        if (value >= 40) return 'Có cảm tình';
        if (value >= 20) return 'Thân thiện';
        if (value >= 0) return 'Trung lập';
        if (value >= -20) return 'Lạnh nhạt';
        if (value >= -40) return 'Chán ghét';
        if (value >= -60) return 'Thù địch';
        return 'Căm hận';
    }

    /**
     * Dựa trên danh sách thẻ do người dùng cấu hình (phân tách bằng dấu phẩy),
     * gỡ bỏ toàn bộ các thẻ tương ứng cùng với nội dung của chúng (bao gồm cả các thuộc tính tùy chọn),
     * để ngăn chặn các thẻ horae bên trong kịch nhỏ gây ô nhiễm kết quả phân tích văn bản chính.
     */
    _stripCustomTags(text, tagList) {
        if (!text || !tagList) return text;
        const tags = tagList.split(/[,，\s]+/).map(t => t.trim()).filter(Boolean);
        for (const tag of tags) {
            const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            text = text.replace(new RegExp(`<${escaped}(?:\\s[^>]*)?>[\\s\\S]*?</${escaped}>`, 'gi'), '');
        }
        return text;
    }

    /** Phân tích thẻ horae trong phản hồi của AI */
    parseHoraeTag(message) {
        if (!message) return null;
        
        // Trích xuất tất cả các khối <horae> và chọn khối chứa trường hợp lệ (ngăn chặn các thẻ cùng tên do plugin khác tạo ra can thiệp)
        let match = null;
        const allHoraeMatches = [...message.matchAll(/<horae>([\s\S]*?)<\/horae>/gi)];
        const horaeFieldPattern = /^(time|timestamp|location|atmosphere|scene_desc|characters|costume|item[!]*|item-|event|affection|npc|agenda|agenda-|rel|mood):/m;
        if (allHoraeMatches.length > 1) {
            match = allHoraeMatches.find(m => horaeFieldPattern.test(m[1])) || allHoraeMatches[0];
        } else if (allHoraeMatches.length === 1) {
            match = allHoraeMatches[0];
        }
        if (!match) {
            match = message.match(//i);
        }
        
        const allEventMatches = [...message.matchAll(/<horaeevent>([\s\S]*?)<\/horaeevent>/gi)];
        const eventMatch = allEventMatches.length > 1
            ? (allEventMatches.find(m => /^event:/m.test(m[1])) || allEventMatches[0])
            : allEventMatches[0] || null;
        const tableMatches = [...message.matchAll(/<horaetable[:：]\s*(.+?)>([\s\S]*?)<\/horaetable>/gi)];
        const rpgMatches = [...message.matchAll(/<horaerpg>([\s\S]*?)<\/horaerpg>/gi)];
        
        if (!match && !eventMatch && tableMatches.length === 0 && rpgMatches.length === 0) return null;
        
        const content = match ? match[1].trim() : '';
        const eventContent = eventMatch ? eventMatch[1].trim() : '';
        const lines = content.split('\n').concat(eventContent.split('\n'));
        
        const result = {
            timestamp: {},
            costumes: {},
            items: {},
            deletedItems: [],
            events: [],
            affection: {},
            npcs: {},
            scene: {},
            agenda: [],
            deletedAgenda: [],
            mood: {},
            relationships: [],
        };
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            
            // time:10/1 15:00 hoặc time:Năm Vĩnh Dạ 2931 Lịch Thị Trấn Nhỏ Ngày 1 tháng 2 (Thứ Sáu) 20:30
            if (trimmedLine.startsWith('time:')) {
                const timeStr = trimmedLine.substring(5).trim();
                // Tách thời gian đồng hồ HH:MM từ cuối
                const clockMatch = timeStr.match(/\b(\d{1,2}:\d{2})\s*$/);
                if (clockMatch) {
                    result.timestamp.story_time = clockMatch[1];
                    result.timestamp.story_date = timeStr.substring(0, timeStr.lastIndexOf(clockMatch[1])).trim();
                } else {
                    // Không có thời gian đồng hồ, sử dụng toàn bộ chuỗi làm ngày tháng
                    result.timestamp.story_date = timeStr;
                    result.timestamp.story_time = '';
                }
            }
            // location:Tầng hai quán cà phê
            else if (trimmedLine.startsWith('location:')) {
                result.scene.location = trimmedLine.substring(9).trim();
            }
            // atmosphere:Thư giãn
            else if (trimmedLine.startsWith('atmosphere:')) {
                result.scene.atmosphere = trimmedLine.substring(11).trim();
            }
            // scene_desc:Mô tả đặc điểm vật lý cố định của địa điểm (hỗ trợ ghép nối nhiều bối cảnh trong cùng một phản hồi)
            else if (trimmedLine.startsWith('scene_desc:')) {
                const desc = trimmedLine.substring(11).trim();
                result.scene.scene_desc = desc;
                if (result.scene.location && desc) {
                    if (!result.scene._descPairs) result.scene._descPairs = [];
                    result.scene._descPairs.push({ location: result.scene.location, desc });
                }
            }
            // characters:Alice,Bob
            else if (trimmedLine.startsWith('characters:')) {
                const chars = trimmedLine.substring(11).trim();
                result.scene.characters_present = chars.split(/[,，]/).map(c => c.trim()).filter(Boolean);
            }
            // costume:Alice=Váy liền trắng
            else if (trimmedLine.startsWith('costume:')) {
                const costumeStr = trimmedLine.substring(8).trim();
                const eqIndex = costumeStr.indexOf('=');
                if (eqIndex > 0) {
                    const char = costumeStr.substring(0, eqIndex).trim();
                    const costume = costumeStr.substring(eqIndex + 1).trim();
                    result.costumes[char] = costume;
                }
            }
            // item-:Tên vật phẩm Biểu thị vật phẩm đã tiêu hao/bị xóa
            else if (trimmedLine.startsWith('item-:')) {
                const itemName = trimmedLine.substring(6).trim();
                const cleanName = itemName.replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, '').trim();
                if (cleanName) {
                    result.deletedItems.push(cleanName);
                }
            }
            // item:🍺Bia mạch kém chất lượng|Mô tả=Quán rượu@Quầy bar / item!:📜Vật phẩm quan trọng|Mô tả chức năng đặc biệt=Nhân vật@Vị trí / item!!:💎Vật phẩm then chốt=@Vị trí
            else if (trimmedLine.startsWith('item!!:') || trimmedLine.startsWith('item!:') || trimmedLine.startsWith('item:')) {
                let importance = '';  // Thường dùng chuỗi rỗng
                let itemStr;
                if (trimmedLine.startsWith('item!!:')) {
                    importance = '!!';  // Quan trọng (Chìa khóa)
                    itemStr = trimmedLine.substring(7).trim();
                } else if (trimmedLine.startsWith('item!:')) {
                    importance = '!';   // Quan trọng
                    itemStr = trimmedLine.substring(6).trim();
                } else {
                    itemStr = trimmedLine.substring(5).trim();
                }
                
                const eqIndex = itemStr.indexOf('=');
                if (eqIndex > 0) {
                    let itemNamePart = itemStr.substring(0, eqIndex).trim();
                    const rest = itemStr.substring(eqIndex + 1).trim();
                    
                    let icon = null;
                    let itemName = itemNamePart;
                    let description = undefined;  // undefined = Khi hợp nhất không ghi đè mô tả ban đầu
                    
                    const emojiMatch = itemNamePart.match(/^([\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{231A}-\u{231B}]|[\u{23E9}-\u{23F3}]|[\u{23F8}-\u{23FA}]|[\u{25AA}-\u{25AB}]|[\u{25B6}]|[\u{25C0}]|[\u{25FB}-\u{25FE}]|[\u{2614}-\u{2615}]|[\u{2648}-\u{2653}]|[\u{267F}]|[\u{2693}]|[\u{26A1}]|[\u{26AA}-\u{26AB}]|[\u{26BD}-\u{26BE}]|[\u{26C4}-\u{26C5}]|[\u{26CE}]|[\u{26D4}]|[\u{26EA}]|[\u{26F2}-\u{26F3}]|[\u{26F5}]|[\u{26FA}]|[\u{26FD}]|[\u{2702}]|[\u{2705}]|[\u{2708}-\u{270D}]|[\u{270F}]|[\u{2712}]|[\u{2714}]|[\u{2716}]|[\u{271D}]|[\u{2721}]|[\u{2728}]|[\u{2733}-\u{2734}]|[\u{2744}]|[\u{2747}]|[\u{274C}]|[\u{274E}]|[\u{2753}-\u{2755}]|[\u{2757}]|[\u{2763}-\u{2764}]|[\u{2795}-\u{2797}]|[\u{27A1}]|[\u{27B0}]|[\u{27BF}]|[\u{2934}-\u{2935}]|[\u{2B05}-\u{2B07}]|[\u{2B1B}-\u{2B1C}]|[\u{2B50}]|[\u{2B55}]|[\u{3030}]|[\u{303D}]|[\u{3297}]|[\u{3299}])/u);
                    if (emojiMatch) {
                        icon = emojiMatch[1];
                        itemNamePart = itemNamePart.substring(icon.length).trim();
                    }
                    
                    const pipeIndex = itemNamePart.indexOf('|');
                    if (pipeIndex > 0) {
                        itemName = itemNamePart.substring(0, pipeIndex).trim();
                        const descText = itemNamePart.substring(pipeIndex + 1).trim();
                        if (descText) description = descText;
                    } else {
                        itemName = itemNamePart;
                    }
                    
                    // Loại bỏ các đánh dấu số lượng không có ý nghĩa
                    itemName = itemName.replace(/[\(（]1[\)）]$/, '').trim();
                    itemName = itemName.replace(new RegExp(`[\\(（]1[${COUNTING_CLASSIFIERS}][\\)）]$`), '').trim();
                    itemName = itemName.replace(new RegExp(`[\\(（][${COUNTING_CLASSIFIERS}][\\)）]$`), '').trim();
                    
                    const atIndex = rest.indexOf('@');
                    const itemInfo = {
                        icon: icon,
                        importance: importance,
                        holder: atIndex >= 0 ? (rest.substring(0, atIndex).trim() || null) : (rest || null),
                        location: atIndex >= 0 ? (rest.substring(atIndex + 1).trim() || '') : ''
                    };
                    if (description !== undefined) itemInfo.description = description;
                    result.items[itemName] = itemInfo;
                }
            }
            // event:Quan trọng|Alice đã thú nhận bí mật
            else if (trimmedLine.startsWith('event:')) {
                const eventStr = trimmedLine.substring(6).trim();
                const parts = eventStr.split('|');
                if (parts.length >= 2) {
                    const levelRaw = parts[0].trim();
                    const summary = parts.slice(1).join('|').trim();
                    
                    let level = 'Bình thường';
                    if (levelRaw === '关键' || levelRaw.toLowerCase() === 'critical' || levelRaw === 'Quan trọng (Chìa khóa)') {
                        level = 'Quan trọng (Chìa khóa)';
                    } else if (levelRaw === '重要' || levelRaw.toLowerCase() === 'important' || levelRaw === 'Quan trọng') {
                        level = 'Quan trọng';
                    }
                    
                    result.events.push({
                        is_important: level === 'Quan trọng' || level === 'Quan trọng (Chìa khóa)',
                        level: level,
                        summary: summary
                    });
                }
            }
            // affection:Bob=65 hoặc affection:Bob+5 (Tương thích định dạng cũ và mới)
            // Bỏ qua việc AI thêm chú thích như affection:Tom=18(+0)|Quan sát thấy xxx, chỉ trích xuất tên và giá trị
            else if (trimmedLine.startsWith('affection:')) {
                const affStr = trimmedLine.substring(10).trim();
                // Định dạng mới: Tên nhân vật=Giá trị số (Giá trị tuyệt đối, cho phép mang dấu dương/âm như =+28 hoặc =-15)
                const absoluteMatch = affStr.match(/^(.+?)=\s*([+\-]?\d+\.?\d*)/);
                if (absoluteMatch) {
                    const key = absoluteMatch[1].trim();
                    const value = parseFloat(absoluteMatch[2]);
                    result.affection[key] = { type: 'absolute', value: value };
                } else {
                    // Định dạng cũ: Tên nhân vật+/-Giá trị số (Giá trị tương đối, không có dấu =) — Cho phép có chú thích bất kỳ sau giá trị số
                    const relativeMatch = affStr.match(/^(.+?)([+\-]\d+\.?\d*)/);
                    if (relativeMatch) {
                        const key = relativeMatch[1].trim();
                        const value = relativeMatch[2];
                        result.affection[key] = { type: 'relative', value: value };
                    }
                }
            }
            // npc:Tên|Ngoại hình=Tính cách@Quan hệ~Giới tính:Nam~Tuổi:25~Chủng tộc:Loài người~Nghề nghiệp:Lính đánh thuê~Bổ sung:xxx
            // Sử dụng ~ để phân tách các trường mở rộng (key:value), không phụ thuộc vào thứ tự
            else if (trimmedLine.startsWith('npc:')) {
                const npcStr = trimmedLine.substring(4).trim();
                const npcInfo = this._parseNpcFields(npcStr);
                const name = npcInfo._name;
                delete npcInfo._name;
                
                if (name) {
                    npcInfo.last_seen = new Date().toISOString();
                    if (!result.npcs[name]) {
                        npcInfo.first_seen = new Date().toISOString();
                    }
                    result.npcs[name] = npcInfo;
                }
            }
            // agenda-:Nội dung việc cần làm đã hoàn thành / agenda:Ngày thiết lập|Nội dung
            else if (trimmedLine.startsWith('agenda-:')) {
                const delStr = trimmedLine.substring(8).trim();
                if (delStr) {
                    const pipeIdx = delStr.indexOf('|');
                    const text = pipeIdx > 0 ? delStr.substring(pipeIdx + 1).trim() : delStr;
                    if (text) {
                        result.deletedAgenda.push(text);
                    }
                }
            }
            else if (trimmedLine.startsWith('agenda:')) {
                const agendaStr = trimmedLine.substring(7).trim();
                const pipeIdx = agendaStr.indexOf('|');
                let dateStr = '', text = '';
                if (pipeIdx > 0) {
                    dateStr = agendaStr.substring(0, pipeIdx).trim();
                    text = agendaStr.substring(pipeIdx + 1).trim();
                } else {
                    text = agendaStr;
                }
                if (text) {
                    // Kiểm tra tình huống AI dùng ngoặc để đánh dấu hoàn thành, tự động đưa vào deletedAgenda
                    const doneMatch = text.match(/[\(（](hoàn thành|đã hoàn thành|done|finished|completed|hết hiệu lực|hủy|đã hủy)[\)）]\s*$/i);
                    if (doneMatch) {
                        const cleanText = text.substring(0, text.length - doneMatch[0].length).trim();
                        if (cleanText) result.deletedAgenda.push(cleanText);
                    } else {
                        result.agenda.push({ date: dateStr, text, source: 'ai', done: false });
                    }
                }
            }
            // rel:Nhân vật A>Nhân vật B=Loại quan hệ|Ghi chú
            else if (trimmedLine.startsWith('rel:')) {
                const relStr = trimmedLine.substring(4).trim();
                const arrowIdx = relStr.indexOf('>');
                const eqIdx = relStr.indexOf('=');
                if (arrowIdx > 0 && eqIdx > arrowIdx) {
                    const from = relStr.substring(0, arrowIdx).trim();
                    const to = relStr.substring(arrowIdx + 1, eqIdx).trim();
                    const rest = relStr.substring(eqIdx + 1).trim();
                    const pipeIdx = rest.indexOf('|');
                    const type = pipeIdx > 0 ? rest.substring(0, pipeIdx).trim() : rest;
                    const note = pipeIdx > 0 ? rest.substring(pipeIdx + 1).trim() : '';
                    if (from && to && type) {
                        result.relationships.push({ from, to, type, note });
                    }
                }
            }
            // mood:Tên nhân vật=Trạng thái cảm xúc
            else if (trimmedLine.startsWith('mood:')) {
                const moodStr = trimmedLine.substring(5).trim();
                const eqIdx = moodStr.indexOf('=');
                if (eqIdx > 0) {
                    const charName = moodStr.substring(0, eqIdx).trim();
                    const emotion = moodStr.substring(eqIdx + 1).trim();
                    if (charName && emotion) {
                        result.mood[charName] = emotion;
                    }
                }
            }
        }

        // Phân tích dữ liệu bảng biểu tùy chỉnh
        if (tableMatches.length > 0) {
            result.tableUpdates = [];
            for (const tm of tableMatches) {
                const tableName = tm[1].trim();
                const tableContent = tm[2].trim();
                const updates = this._parseTableCellEntries(tableContent);
                
                if (Object.keys(updates).length > 0) {
                    result.tableUpdates.push({ name: tableName, updates });
                }
            }
        }

        // Phân tích dữ liệu RPG
        if (rpgMatches.length > 0) {
            result.rpg = { bars: {}, status: {}, skills: [], removedSkills: [], attributes: {}, reputation: {}, equipment: [], unequip: [], levels: {}, xp: {}, currency: [], baseChanges: [] };
            for (const rm of rpgMatches) {
                const rpgContent = rm[1].trim();
                for (const rpgLine of rpgContent.split('\n')) {
                    const trimmed = rpgLine.trim();
                    if (trimmed) this._parseRpgLine(trimmed, result.rpg);
                }
            }
        }

        return result;
    }

    /** Hợp nhất kết quả phân tích vào siêu dữ liệu */
    mergeParsedToMeta(baseMeta, parsed) {
        const meta = baseMeta ? JSON.parse(JSON.stringify(baseMeta)) : createEmptyMeta();
        
        if (parsed.timestamp?.story_date) {
            meta.timestamp.story_date = parsed.timestamp.story_date;
        }
        if (parsed.timestamp?.story_time) {
            meta.timestamp.story_time = parsed.timestamp.story_time;
        }
        meta.timestamp.absolute = new Date().toISOString();
        
        if (parsed.scene?.location) {
            meta.scene.location = parsed.scene.location;
        }
        if (parsed.scene?.atmosphere) {
            meta.scene.atmosphere = parsed.scene.atmosphere;
        }
        if (parsed.scene?.scene_desc) {
            meta.scene.scene_desc = parsed.scene.scene_desc;
        }
        if (parsed.scene?.characters_present?.length > 0) {
            meta.scene.characters_present = parsed.scene.characters_present;
        }
        
        if (parsed.costumes) {
            Object.assign(meta.costumes, parsed.costumes);
        }
        
        if (parsed.items) {
            Object.assign(meta.items, parsed.items);
        }
        
        if (parsed.deletedItems && parsed.deletedItems.length > 0) {
            if (!meta.deletedItems) meta.deletedItems = [];
            meta.deletedItems = [...new Set([...meta.deletedItems, ...parsed.deletedItems])];
        }
        
        // Hỗ trợ định dạng mới (mảng events) và định dạng cũ (event đơn)
        if (parsed.events && parsed.events.length > 0) {
            meta.events = parsed.events;
        } else if (parsed.event) {
            // Tương thích định dạng cũ: chuyển đổi thành mảng
            meta.events = [parsed.event];
        }
        
        if (parsed.affection) {
            Object.assign(meta.affection, parsed.affection);
        }
        
        if (parsed.npcs) {
            Object.assign(meta.npcs, parsed.npcs);
        }
        
        // Bổ sung việc cần làm do AI viết (bỏ qua những việc người dùng đã xóa thủ công)
        if (parsed.agenda && parsed.agenda.length > 0) {
            if (!meta.agenda) meta.agenda = [];
            const chat0 = this.getChat()?.[0];
            const deletedSet = new Set(chat0?.horae_meta?._deletedAgendaTexts || []);
            for (const item of parsed.agenda) {
                if (deletedSet.has(item.text)) continue;
                const isDupe = meta.agenda.some(a => a.text === item.text);
                if (!isDupe) {
                    meta.agenda.push(item);
                }
            }
        }
        
        // Mạng lưới quan hệ: lưu vào tin nhắn hiện tại (sau đó sẽ được processAIResponse hợp nhất vào chat[0])
        if (parsed.relationships && parsed.relationships.length > 0) {
            if (!meta.relationships) meta.relationships = [];
            meta.relationships = parsed.relationships;
        }
        
        // Trạng thái cảm xúc
        if (parsed.mood && Object.keys(parsed.mood).length > 0) {
            if (!meta.mood) meta.mood = {};
            Object.assign(meta.mood, parsed.mood);
        }
        
        // tableUpdates được truyền dưới dạng thuộc tính phụ
        if (parsed.tableUpdates) {
            meta._tableUpdates = parsed.tableUpdates;
        }
        
        if (parsed.rpg) {
            meta._rpgChanges = parsed.rpg;
        }
        
        return meta;
    }

    /** Phân tích một dòng dữ liệu RPG */
    _parseRpgLine(line, rpg) {
        const _uoName = this.context?.name1 || 'Nhân vật chính';
        const _uoB = !!this.settings?.rpgBarsUserOnly;
        const _uoS = !!this.settings?.rpgSkillsUserOnly;
        const _uoA = !!this.settings?.rpgAttrsUserOnly;
        const _uoE = !!this.settings?.rpgEquipmentUserOnly;
        const _uoR = !!this.settings?.rpgReputationUserOnly;
        const _uoL = !!this.settings?.rpgLevelUserOnly;
        const _uoC = !!this.settings?.rpgCurrencyUserOnly;

        // Chung: Kiểm tra xem dòng có phải là định dạng userOnly không có owner không (đoạn đầu chứa = là định dạng bình thường, nếu không có thể là định dạng UO)
        // Thanh thuộc tính: Bình thường key:owner=cur/max hoặc userOnly key:cur/max(Tên hiển thị)
        const barNormal = line.match(/^([a-zA-Z]\w*):(.+?)=(\d+)\s*\/\s*(\d+)(?:\((.+?)\))?$/i);
        const barUo = _uoB ? line.match(/^([a-zA-Z]\w*):(\d+)\s*\/\s*(\d+)(?:\((.+?)\))?$/i) : null;
        if (barNormal && !/^(status|skill)$/i.test(barNormal[1])) {
            const type = barNormal[1].toLowerCase();
            const owner = _uoB ? _uoName : barNormal[2].trim();
            const current = parseInt(barNormal[3]);
            const max = parseInt(barNormal[4]);
            const label = barNormal[5]?.trim() || null;
            if (!rpg.bars[owner]) rpg.bars[owner] = {};
            rpg.bars[owner][type] = label ? [current, max, label] : [current, max];
            return;
        }
        if (barUo && !/^(status|skill)$/i.test(barUo[1])) {
            const type = barUo[1].toLowerCase();
            const current = parseInt(barUo[2]);
            const max = parseInt(barUo[3]);
            const label = barUo[4]?.trim() || null;
            if (!rpg.bars[_uoName]) rpg.bars[_uoName] = {};
            rpg.bars[_uoName][type] = label ? [current, max, label] : [current, max];
            return;
        }
        // status
        if (line.startsWith('status:')) {
            const str = line.substring(7).trim();
            const eq = str.indexOf('=');
            if (_uoB && eq < 0) {
                rpg.status[_uoName] = (!str || /^(正常|无|none|bình thường|không có)$/i.test(str))
                    ? [] : str.split(/[,，/]/).map(s => s.trim()).filter(Boolean);
            } else if (eq > 0) {
                const owner = _uoB ? _uoName : str.substring(0, eq).trim();
                const val = str.substring(eq + 1).trim();
                rpg.status[owner] = (!val || /^(正常|无|none|bình thường|không có)$/i.test(val))
                    ? [] : val.split(/[,，/]/).map(s => s.trim()).filter(Boolean);
            }
            return;
        }
        // skill
        if (line.startsWith('skill:')) {
            const parts = line.substring(6).trim().split('|').map(s => s.trim());
            if (_uoS && parts.length >= 1) {
                rpg.skills.push({ owner: _uoName, name: parts[0], level: parts[1] || '', desc: parts[2] || '' });
            } else if (parts.length >= 2) {
                rpg.skills.push({ owner: parts[0], name: parts[1], level: parts[2] || '', desc: parts[3] || '' });
            }
            return;
        }
        // skill-
        if (line.startsWith('skill-:')) {
            const parts = line.substring(7).trim().split('|').map(s => s.trim());
            if (_uoS && parts.length >= 1) {
                rpg.removedSkills.push({ owner: _uoName, name: parts[0] });
            } else if (parts.length >= 2) {
                rpg.removedSkills.push({ owner: parts[0], name: parts[1] });
            }
            return;
        }
        // equip
        if (line.startsWith('equip:')) {
            const parts = line.substring(6).trim().split('|').map(s => s.trim());
            const minParts = _uoE ? 2 : 3;
            if (parts.length >= minParts) {
                const owner = _uoE ? _uoName : parts[0];
                const slot = _uoE ? parts[0] : parts[1];
                const itemName = _uoE ? parts[1] : parts[2];
                const attrPart = _uoE ? parts[2] : parts[3];
                const attrs = {};
                if (attrPart) {
                    for (const kv of attrPart.split(',')) {
                        const m = kv.trim().match(/^(.+?)=(-?\d+)$/);
                        if (m) attrs[m[1].trim()] = parseInt(m[2]);
                    }
                }
                if (!rpg.equipment) rpg.equipment = [];
                rpg.equipment.push({ owner, slot, name: itemName, attrs });
            }
            return;
        }
        // unequip
        if (line.startsWith('unequip:')) {
            const parts = line.substring(8).trim().split('|').map(s => s.trim());
            const minParts = _uoE ? 2 : 3;
            if (parts.length >= minParts) {
                if (!rpg.unequip) rpg.unequip = [];
                if (_uoE) {
                    rpg.unequip.push({ owner: _uoName, slot: parts[0], name: parts[1] });
                } else {
                    rpg.unequip.push({ owner: parts[0], slot: parts[1], name: parts[2] });
                }
            }
            return;
        }
        // rep
        if (line.startsWith('rep:')) {
            const parts = line.substring(4).trim().split('|').map(s => s.trim());
            if (_uoR && parts.length >= 1) {
                const kv = parts[0].match(/^(.+?)=(-?\d+)$/);
                if (kv) {
                    if (!rpg.reputation) rpg.reputation = {};
                    if (!rpg.reputation[_uoName]) rpg.reputation[_uoName] = {};
                    rpg.reputation[_uoName][kv[1].trim()] = parseInt(kv[2]);
                }
            } else if (parts.length >= 2) {
                const owner = parts[0];
                const kv = parts[1].match(/^(.+?)=(-?\d+)$/);
                if (kv) {
                    if (!rpg.reputation) rpg.reputation = {};
                    if (!rpg.reputation[owner]) rpg.reputation[owner] = {};
                    rpg.reputation[owner][kv[1].trim()] = parseInt(kv[2]);
                }
            }
            return;
        }
        // level
        if (line.startsWith('level:')) {
            const str = line.substring(6).trim();
            if (_uoL) {
                const val = parseInt(str);
                if (!isNaN(val)) {
                    if (!rpg.levels) rpg.levels = {};
                    rpg.levels[_uoName] = val;
                }
            } else {
                const eq = str.indexOf('=');
                if (eq > 0) {
                    const owner = str.substring(0, eq).trim();
                    const val = parseInt(str.substring(eq + 1).trim());
                    if (!isNaN(val)) {
                        if (!rpg.levels) rpg.levels = {};
                        rpg.levels[owner] = val;
                    }
                }
            }
            return;
        }
        // xp
        if (line.startsWith('xp:')) {
            const str = line.substring(3).trim();
            if (_uoL) {
                const m = str.match(/^(\d+)\s*\/\s*(\d+)$/);
                if (m) {
                    if (!rpg.xp) rpg.xp = {};
                    rpg.xp[_uoName] = [parseInt(m[1]), parseInt(m[2])];
                }
            } else {
                const eq = str.indexOf('=');
                if (eq > 0) {
                    const owner = str.substring(0, eq).trim();
                    const valStr = str.substring(eq + 1).trim();
                    const m = valStr.match(/^(\d+)\s*\/\s*(\d+)$/);
                    if (m) {
                        if (!rpg.xp) rpg.xp = {};
                        rpg.xp[owner] = [parseInt(m[1]), parseInt(m[2])];
                    }
                }
            }
            return;
        }
        // currency
        if (line.startsWith('currency:')) {
            const parts = line.substring(9).trim().split('|').map(s => s.trim());
            if (_uoC && parts.length >= 1) {
                const kvStr = parts.length >= 2 ? parts[1] : parts[0];
                const kv = kvStr.match(/^(.+?)=([+-]?\d+)$/);
                if (kv) {
                    if (!rpg.currency) rpg.currency = [];
                    const rawVal = kv[2];
                    const isDelta = rawVal.startsWith('+') || rawVal.startsWith('-');
                    rpg.currency.push({ owner: _uoName, name: kv[1].trim(), value: parseInt(rawVal), isDelta });
                }
            } else if (parts.length >= 2) {
                const owner = parts[0];
                const kv = parts[1].match(/^(.+?)=([+-]?\d+)$/);
                if (kv) {
                    if (!rpg.currency) rpg.currency = [];
                    const rawVal = kv[2];
                    const isDelta = rawVal.startsWith('+') || rawVal.startsWith('-');
                    rpg.currency.push({ owner, name: kv[1].trim(), value: parseInt(rawVal), isDelta });
                }
            }
            return;
        }
        // attr
        if (line.startsWith('attr:')) {
            const parts = line.substring(5).trim().split('|').map(s => s.trim());
            if (parts.length >= 1) {
                let owner, startIdx;
                if (_uoA) {
                    owner = _uoName;
                    startIdx = 0;
                } else {
                    owner = parts[0];
                    startIdx = 1;
                }
                const vals = {};
                for (let i = startIdx; i < parts.length; i++) {
                    const kv = parts[i].match(/^(\w+)=(\d+)$/);
                    if (kv) vals[kv[1].toLowerCase()] = parseInt(kv[2]);
                }
                if (Object.keys(vals).length) {
                    if (!rpg.attributes) rpg.attributes = {};
                    rpg.attributes[owner] = vals;
                }
            }
            return;
        }
        // base:Đường dẫn cứ điểm=Cấp độ hoặc base:Đường dẫn cứ điểm|desc=Mô tả
        // Đường dẫn phân cấp bằng >, ví dụ base:Trang viên nhân vật chính>Khu rèn>Lò rèn=2
        if (line.startsWith('base:')) {
            if (!rpg.baseChanges) rpg.baseChanges = [];
            const raw = line.substring(5).trim();
            const pipeIdx = raw.indexOf('|');
            if (pipeIdx >= 0) {
                const path = raw.substring(0, pipeIdx).trim();
                const rest = raw.substring(pipeIdx + 1).trim();
                const kv = rest.match(/^(desc|level)=(.+)$/);
                if (kv) {
                    rpg.baseChanges.push({ path, field: kv[1], value: kv[2].trim() });
                }
            } else {
                const eqIdx = raw.indexOf('=');
                if (eqIdx >= 0) {
                    const path = raw.substring(0, eqIdx).trim();
                    const val = raw.substring(eqIdx + 1).trim();
                    const numVal = parseInt(val);
                    if (!isNaN(numVal)) {
                        rpg.baseChanges.push({ path, field: 'level', value: numVal });
                    } else {
                        rpg.baseChanges.push({ path, field: 'desc', value: val });
                    }
                }
            }
        }
    }

    /** Thông qua N(Số thứ tự) để phân tích tên quy chuẩn của người nắm giữ */
    _resolveRpgOwner(ownerStr) {
        const m = ownerStr.match(/^N(\d+)\s+(.+)$/);
        if (m) {
            const npcId = m[1];
            const padded = padItemId(parseInt(npcId, 10));
            const chat = this.getChat();
            for (let i = chat.length - 1; i >= 0; i--) {
                const npcs = chat[i]?.horae_meta?.npcs;
                if (!npcs) continue;
                for (const [name, info] of Object.entries(npcs)) {
                    if (String(info._id) === npcId || info._id === padded) return name;
                }
            }
            return m[2].trim();
        }
        return ownerStr.trim();
    }

    /** Hợp nhất các thay đổi RPG vào chat[0].horae_meta.rpg */
    _mergeRpgData(changes) {
        const chat = this.getChat();
        if (!chat?.length || !changes) return;
        const first = chat[0];
        if (!first.horae_meta) first.horae_meta = createEmptyMeta();
        if (!first.horae_meta.rpg) first.horae_meta.rpg = { bars: {}, status: {}, skills: {} };
        const rpg = first.horae_meta.rpg;

        const _mUN = this.context?.name1 || '';

        for (const [raw, barData] of Object.entries(changes.bars || {})) {
            const owner = this._resolveRpgOwner(raw);
            if (this.settings?.rpgBarsUserOnly && owner !== _mUN) continue;
            if (!rpg.bars[owner]) rpg.bars[owner] = {};
            Object.assign(rpg.bars[owner], barData);
        }
        for (const [raw, effects] of Object.entries(changes.status || {})) {
            const owner = this._resolveRpgOwner(raw);
            if (this.settings?.rpgBarsUserOnly && owner !== _mUN) continue;
            if (!rpg.status) rpg.status = {};
            rpg.status[owner] = effects;
        }
        for (const sk of (changes.skills || [])) {
            const owner = this._resolveRpgOwner(sk.owner);
            if (this.settings?.rpgSkillsUserOnly && owner !== _mUN) continue;
            if (!rpg.skills[owner]) rpg.skills[owner] = [];
            const idx = rpg.skills[owner].findIndex(s => s.name === sk.name);
            if (idx >= 0) {
                if (sk.level) rpg.skills[owner][idx].level = sk.level;
                if (sk.desc) rpg.skills[owner][idx].desc = sk.desc;
            } else {
                rpg.skills[owner].push({ name: sk.name, level: sk.level, desc: sk.desc });
            }
        }
        for (const sk of (changes.removedSkills || [])) {
            const owner = this._resolveRpgOwner(sk.owner);
            if (this.settings?.rpgSkillsUserOnly && owner !== _mUN) continue;
            if (rpg.skills[owner]) {
                rpg.skills[owner] = rpg.skills[owner].filter(s => s.name !== sk.name);
            }
        }
        // Thuộc tính đa chiều
        for (const [raw, vals] of Object.entries(changes.attributes || {})) {
            const owner = this._resolveRpgOwner(raw);
            if (this.settings?.rpgAttrsUserOnly && owner !== _mUN) continue;
            if (!rpg.attributes) rpg.attributes = {};
            rpg.attributes[owner] = { ...(rpg.attributes[owner] || {}), ...vals };
        }
        // Trang bị: Cấu hình ô độc lập theo từng nhân vật
        if (changes.equipment?.length > 0 || changes.unequip?.length > 0) {
            if (!rpg.equipmentConfig) rpg.equipmentConfig = { locked: false, perChar: {} };
            if (!rpg.equipmentConfig.perChar) rpg.equipmentConfig.perChar = {};
            if (!rpg.equipment) rpg.equipment = {};
            const _getOwnerSlots = (owner) => {
                const pc = rpg.equipmentConfig.perChar[owner];
                if (!pc || !Array.isArray(pc.slots)) return { valid: new Set(), deleted: new Set(), maxMap: {} };
                return {
                    valid: new Set(pc.slots.map(s => s.name)),
                    deleted: new Set(pc._deletedSlots || []),
                    maxMap: Object.fromEntries(pc.slots.map(s => [s.name, s.maxCount ?? 1])),
                };
            };
            const _findAndTakeItem = (name) => {
                const state = this.getLatestState();
                const itemInfo = state?.items?.[name];
                if (!itemInfo) return null;
                const meta = { icon: itemInfo.icon || '', description: itemInfo.description || '', importance: itemInfo.importance || '', _id: itemInfo._id || '', _locked: itemInfo._locked || false };
                for (let k = chat.length - 1; k >= 0; k--) {
                    if (chat[k]?.horae_meta?.items?.[name]) { delete chat[k].horae_meta.items[name]; break; }
                }
                return meta;
            };
            const _returnItemFromEquip = (entry, owner) => {
                if (!first.horae_meta.items) first.horae_meta.items = {};
                const m = entry._itemMeta || {};
                first.horae_meta.items[entry.name] = {
                    icon: m.icon || '📦', description: m.description || '', importance: m.importance || '',
                    holder: owner, location: '', _id: m._id || '', _locked: m._locked || false,
                };
            };
            for (const u of (changes.unequip || [])) {
                const owner = this._resolveRpgOwner(u.owner);
                if (this.settings?.rpgEquipmentUserOnly && owner !== _mUN) continue;
                if (!rpg.equipment[owner]?.[u.slot]) continue;
                const removed = rpg.equipment[owner][u.slot].find(e => e.name === u.name);
                rpg.equipment[owner][u.slot] = rpg.equipment[owner][u.slot].filter(e => e.name !== u.name);
                if (removed) _returnItemFromEquip(removed, owner);
                if (!rpg.equipment[owner][u.slot].length) delete rpg.equipment[owner][u.slot];
                if (rpg.equipment[owner] && !Object.keys(rpg.equipment[owner]).length) delete rpg.equipment[owner];
            }
            for (const eq of (changes.equipment || [])) {
                const slotName = eq.slot;
                const owner = this._resolveRpgOwner(eq.owner);
                if (this.settings?.rpgEquipmentUserOnly && owner !== _mUN) continue;
                const { valid, deleted, maxMap } = _getOwnerSlots(owner);
                if (valid.size > 0 && (!valid.has(slotName) || deleted.has(slotName))) continue;
                if (!rpg.equipment[owner]) rpg.equipment[owner] = {};
                if (!rpg.equipment[owner][slotName]) rpg.equipment[owner][slotName] = [];
                const existing = rpg.equipment[owner][slotName].findIndex(e => e.name === eq.name);
                if (existing >= 0) {
                    rpg.equipment[owner][slotName][existing].attrs = eq.attrs;
                } else {
                    const maxCount = maxMap[slotName] ?? 1;
                    if (rpg.equipment[owner][slotName].length >= maxCount) {
                        const bumped = rpg.equipment[owner][slotName].shift();
                        if (bumped) _returnItemFromEquip(bumped, owner);
                    }
                    const itemMeta = _findAndTakeItem(eq.name);
                    rpg.equipment[owner][slotName].push({ name: eq.name, attrs: eq.attrs || {}, ...(itemMeta ? { _itemMeta: itemMeta } : {}) });
                }
            }
        }
        // Danh tiếng: Chỉ chấp nhận các phân loại đã được định nghĩa và chưa bị xóa trong reputationConfig
        if (changes.reputation && Object.keys(changes.reputation).length > 0) {
            if (!rpg.reputationConfig) rpg.reputationConfig = { categories: [], _deletedCategories: [] };
            if (!rpg.reputation) rpg.reputation = {};
            const validNames = new Set((rpg.reputationConfig.categories || []).map(c => c.name));
            const deleted = new Set(rpg.reputationConfig._deletedCategories || []);
            for (const [raw, cats] of Object.entries(changes.reputation)) {
                const owner = this._resolveRpgOwner(raw);
                if (this.settings?.rpgReputationUserOnly && owner !== _mUN) continue;
                if (!rpg.reputation[owner]) rpg.reputation[owner] = {};
                for (const [catName, val] of Object.entries(cats)) {
                    if (!validNames.has(catName) || deleted.has(catName)) continue;
                    const cfg = rpg.reputationConfig.categories.find(c => c.name === catName);
                    const clamped = Math.max(cfg?.min ?? -100, Math.min(cfg?.max ?? 100, val));
                    if (!rpg.reputation[owner][catName]) {
                        rpg.reputation[owner][catName] = { value: clamped, subItems: {} };
                    } else {
                        rpg.reputation[owner][catName].value = clamped;
                    }
                }
            }
        }
        // Cấp độ
        for (const [raw, val] of Object.entries(changes.levels || {})) {
            const owner = this._resolveRpgOwner(raw);
            if (this.settings?.rpgLevelUserOnly && owner !== _mUN) continue;
            if (!rpg.levels) rpg.levels = {};
            rpg.levels[owner] = val;
        }
        // Điểm kinh nghiệm
        for (const [raw, val] of Object.entries(changes.xp || {})) {
            const owner = this._resolveRpgOwner(raw);
            if (this.settings?.rpgLevelUserOnly && owner !== _mUN) continue;
            if (!rpg.xp) rpg.xp = {};
            rpg.xp[owner] = val;
        }
        // Tiền tệ: Chỉ chấp nhận các loại tiền đã được định nghĩa trong currencyConfig
        if (changes.currency?.length > 0) {
            if (!rpg.currencyConfig) rpg.currencyConfig = { denominations: [] };
            if (!rpg.currency) rpg.currency = {};
            const validDenoms = new Set((rpg.currencyConfig.denominations || []).map(d => d.name));
            for (const c of changes.currency) {
                const owner = this._resolveRpgOwner(c.owner);
                if (this.settings?.rpgCurrencyUserOnly && owner !== _mUN) continue;
                if (!validDenoms.has(c.name)) continue;
                if (!rpg.currency[owner]) rpg.currency[owner] = {};
                if (c.isDelta) {
                    rpg.currency[owner][c.name] = (rpg.currency[owner][c.name] || 0) + c.value;
                } else {
                    rpg.currency[owner][c.name] = c.value;
                }
            }
        }
        // Thay đổi cứ điểm
        if (changes.baseChanges?.length > 0) {
            if (!rpg.strongholds) rpg.strongholds = [];
            for (const bc of changes.baseChanges) {
                const pathParts = bc.path.split('>').map(s => s.trim()).filter(Boolean);
                let parentId = null;
                let targetNode = null;
                for (const part of pathParts) {
                    targetNode = rpg.strongholds.find(n => n.name === part && (n.parent || null) === parentId);
                    if (!targetNode) {
                        targetNode = { id: 'sh_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: part, level: null, desc: '', parent: parentId };
                        rpg.strongholds.push(targetNode);
                    }
                    parentId = targetNode.id;
                }
                if (targetNode) {
                    if (bc.field === 'level') targetNode.level = typeof bc.value === 'number' ? bc.value : parseInt(bc.value);
                    else if (bc.field === 'desc') targetNode.desc = String(bc.value);
                }
            }
        }
    }

    /** Xây dựng lại dữ liệu toàn cục RPG từ tất cả các tin nhắn (giữ lại các chỉnh sửa thủ công của người dùng) */
    rebuildRpgData() {
        const chat = this.getChat();
        if (!chat?.length) return;
        const first = chat[0];
        if (!first.horae_meta) first.horae_meta = createEmptyMeta();
        const old = first.horae_meta.rpg || {};
        // Giữ lại các kỹ năng người dùng thêm thủ công
        const userSkills = {};
        for (const [owner, arr] of Object.entries(old.skills || {})) {
            const ua = (arr || []).filter(s => s._userAdded);
            if (ua.length) userSkills[owner] = ua;
        }
        // Giữ lại lịch sử xóa thủ công và các thuộc tính người dùng tự điền
        const deletedSkills = old._deletedSkills || [];
        const userAttrs = old.attributes || {};
        // Giữ lại cấu hình danh tiếng và các mục chi tiết do người dùng thiết lập
        const oldRepConfig = old.reputationConfig || { categories: [], _deletedCategories: [] };
        const oldReputation = old.reputation ? JSON.parse(JSON.stringify(old.reputation)) : {};
        // Giữ lại cấu hình trang bị
        const oldEquipConfig = old.equipmentConfig || { locked: false, perChar: {} };
        // Giữ lại cấu hình tiền tệ
        const oldCurrencyConfig = old.currencyConfig || { denominations: [] };

        first.horae_meta.rpg = {
            bars: {}, status: {}, skills: {}, attributes: { ...userAttrs }, _deletedSkills: deletedSkills,
            reputationConfig: oldRepConfig, reputation: {},
            equipmentConfig: oldEquipConfig, equipment: {},
            levels: {}, xp: {},
            currencyConfig: oldCurrencyConfig, currency: {},
        };
        for (let i = 1; i < chat.length; i++) {
            const changes = chat[i]?.horae_meta?._rpgChanges;
            if (changes) this._mergeRpgData(changes);
        }
        // Điền lại các kỹ năng người dùng thêm thủ công
        const rpg = first.horae_meta.rpg;
        for (const [owner, arr] of Object.entries(userSkills)) {
            if (!rpg.skills[owner]) rpg.skills[owner] = [];
            for (const sk of arr) {
                if (!rpg.skills[owner].some(s => s.name === sk.name)) rpg.skills[owner].push(sk);
            }
        }
        // Lọc bỏ các kỹ năng người dùng xóa thủ công
        for (const del of deletedSkills) {
            if (rpg.skills[del.owner]) {
                rpg.skills[del.owner] = rpg.skills[del.owner].filter(s => s.name !== del.name);
                if (!rpg.skills[del.owner].length) delete rpg.skills[del.owner];
            }
        }
        // Điền lại các mục chi tiết danh tiếng do người dùng thiết lập (AI chỉ viết giá trị chính, mục chi tiết là dữ liệu thuần túy của người dùng)
        const deletedRepCats = new Set(rpg.reputationConfig?._deletedCategories || []);
        const validRepCats = new Set((rpg.reputationConfig?.categories || []).map(c => c.name));
        for (const [owner, cats] of Object.entries(oldReputation)) {
            if (!rpg.reputation[owner]) rpg.reputation[owner] = {};
            for (const [catName, data] of Object.entries(cats)) {
                if (deletedRepCats.has(catName) || !validRepCats.has(catName)) continue;
                if (!rpg.reputation[owner][catName]) {
                    rpg.reputation[owner][catName] = data;
                } else {
                    rpg.reputation[owner][catName].subItems = data.subItems || {};
                }
            }
        }
    }

    /** Lấy dữ liệu toàn cục RPG (tích lũy ở chat[0]) */
    getRpgData() {
        return this.getChat()?.[0]?.horae_meta?.rpg || {
            bars: {}, status: {}, skills: {}, attributes: {},
            reputation: {}, reputationConfig: { categories: [], _deletedCategories: [] },
            equipment: {}, equipmentConfig: { locked: false, perChar: {} },
            levels: {}, xp: {},
            currency: {}, currencyConfig: { denominations: [] },
        };
    }

    /**
     * Xây dựng ảnh chụp nhanh RPG tại vị trí tin nhắn được chỉ định (không sửa đổi chat[0])
     * @param {number} skipLast - Bỏ qua N tin nhắn cuối cùng (khi lướt (swipe) = 1)
     */
    getRpgStateAt(skipLast = 0) {
        const chat = this.getChat();
        if (!chat?.length) return { bars: {}, status: {}, skills: {}, attributes: {}, reputation: {}, equipment: {}, levels: {}, xp: {}, currency: {} };
        const end = Math.max(1, chat.length - skipLast);
        const first = chat[0];
        const rpgMeta = first?.horae_meta?.rpg || {};
        const snapshot = {
            bars: {}, status: {}, skills: {}, attributes: {}, reputation: {}, equipment: {},
            levels: JSON.parse(JSON.stringify(rpgMeta.levels || {})),
            xp: JSON.parse(JSON.stringify(rpgMeta.xp || {})),
            currency: JSON.parse(JSON.stringify(rpgMeta.currency || {})),
        };

        // Dữ liệu do người dùng chỉnh sửa thủ công
        const userSkills = {};
        for (const [owner, arr] of Object.entries(rpgMeta.skills || {})) {
            const ua = (arr || []).filter(s => s._userAdded);
            if (ua.length) userSkills[owner] = ua;
        }
        const deletedSkills = rpgMeta._deletedSkills || [];
        const userAttrs = {};
        for (const [owner, vals] of Object.entries(rpgMeta.attributes || {})) {
            userAttrs[owner] = { ...vals };
        }

        // Cấu hình ô trang bị (lấy trước, dùng để xác thực maxCount trong vòng lặp)
        const _eqCfg = rpgMeta.equipmentConfig || { locked: false, perChar: {} };
        const _eqPerChar = _eqCfg.perChar || {};

        // Tích lũy thuộc tính từ tin nhắn (snapshot là đối tượng độc lập, không làm ảnh hưởng chat[0])
        const _resolve = (raw) => this._resolveRpgOwner(raw);
        for (let i = 1; i < end; i++) {
            const changes = chat[i]?.horae_meta?._rpgChanges;
            if (!changes) continue;
            for (const [raw, barData] of Object.entries(changes.bars || {})) {
                const owner = _resolve(raw);
                if (!snapshot.bars[owner]) snapshot.bars[owner] = {};
                Object.assign(snapshot.bars[owner], barData);
            }
            for (const [raw, effects] of Object.entries(changes.status || {})) {
                const owner = _resolve(raw);
                snapshot.status[owner] = effects;
            }
            for (const sk of (changes.skills || [])) {
                const owner = _resolve(sk.owner);
                if (!snapshot.skills[owner]) snapshot.skills[owner] = [];
                const idx = snapshot.skills[owner].findIndex(s => s.name === sk.name);
                if (idx >= 0) {
                    if (sk.level) snapshot.skills[owner][idx].level = sk.level;
                    if (sk.desc) snapshot.skills[owner][idx].desc = sk.desc;
                } else {
                    snapshot.skills[owner].push({ name: sk.name, level: sk.level, desc: sk.desc });
                }
            }
            for (const sk of (changes.removedSkills || [])) {
                const owner = _resolve(sk.owner);
                if (snapshot.skills[owner]) {
                    snapshot.skills[owner] = snapshot.skills[owner].filter(s => s.name !== sk.name);
                }
            }
            for (const [raw, vals] of Object.entries(changes.attributes || {})) {
                const owner = _resolve(raw);
                snapshot.attributes[owner] = { ...(snapshot.attributes[owner] || {}), ...vals };
            }
            for (const [raw, cats] of Object.entries(changes.reputation || {})) {
                const owner = _resolve(raw);
                if (!snapshot.reputation[owner]) snapshot.reputation[owner] = {};
                for (const [catName, val] of Object.entries(cats)) {
                    if (!snapshot.reputation[owner][catName]) {
                        snapshot.reputation[owner][catName] = { value: val, subItems: {} };
                    } else {
                        snapshot.reputation[owner][catName].value = val;
                    }
                }
            }
            // Trang bị
            for (const u of (changes.unequip || [])) {
                const owner = _resolve(u.owner);
                if (!snapshot.equipment[owner]?.[u.slot]) continue;
                snapshot.equipment[owner][u.slot] = snapshot.equipment[owner][u.slot].filter(e => e.name !== u.name);
                if (!snapshot.equipment[owner][u.slot].length) delete snapshot.equipment[owner][u.slot];
                if (!Object.keys(snapshot.equipment[owner] || {}).length) delete snapshot.equipment[owner];
            }
            for (const eq of (changes.equipment || [])) {
                const owner = _resolve(eq.owner);
                const ownerCfg = _eqPerChar[owner];
                const maxCount = (ownerCfg && Array.isArray(ownerCfg.slots))
                    ? (ownerCfg.slots.find(s => s.name === eq.slot)?.maxCount ?? 1) : 1;
                if (!snapshot.equipment[owner]) snapshot.equipment[owner] = {};
                if (!snapshot.equipment[owner][eq.slot]) snapshot.equipment[owner][eq.slot] = [];
                const idx = snapshot.equipment[owner][eq.slot].findIndex(e => e.name === eq.name);
                if (idx >= 0) {
                    snapshot.equipment[owner][eq.slot][idx].attrs = eq.attrs;
                } else {
                    while (snapshot.equipment[owner][eq.slot].length >= maxCount) snapshot.equipment[owner][eq.slot].shift();
                    snapshot.equipment[owner][eq.slot].push({ name: eq.name, attrs: eq.attrs || {} });
                }
            }
            // Cấp độ/Kinh nghiệm
            for (const [raw, val] of Object.entries(changes.levels || {})) {
                snapshot.levels[_resolve(raw)] = val;
            }
            for (const [raw, val] of Object.entries(changes.xp || {})) {
                snapshot.xp[_resolve(raw)] = val;
            }
            // Tiền tệ (lọc bỏ các loại tiền đã bị xóa/chưa đăng ký)
            const validDenoms = new Set(
                (rpgMeta.currencyConfig?.denominations || []).map(d => d.name)
            );
            for (const c of (changes.currency || [])) {
                if (validDenoms.size && !validDenoms.has(c.name)) continue;
                const owner = _resolve(c.owner);
                if (!snapshot.currency[owner]) snapshot.currency[owner] = {};
                if (c.isDelta) {
                    snapshot.currency[owner][c.name] = (snapshot.currency[owner][c.name] || 0) + c.value;
                } else {
                    snapshot.currency[owner][c.name] = c.value;
                }
            }
        }

        // Hợp nhất các thuộc tính thủ công của người dùng (dữ liệu AI ưu tiên ghi đè)
        for (const [owner, vals] of Object.entries(userAttrs)) {
            if (!snapshot.attributes[owner]) snapshot.attributes[owner] = {};
            for (const [k, v] of Object.entries(vals)) {
                if (snapshot.attributes[owner][k] === undefined) snapshot.attributes[owner][k] = v;
            }
        }
        // Điền lại kỹ năng thủ công của người dùng
        for (const [owner, arr] of Object.entries(userSkills)) {
            if (!snapshot.skills[owner]) snapshot.skills[owner] = [];
            for (const sk of arr) {
                if (!snapshot.skills[owner].some(s => s.name === sk.name)) snapshot.skills[owner].push(sk);
            }
        }
        // Lọc bỏ các mục người dùng xóa thủ công
        for (const del of deletedSkills) {
            if (snapshot.skills[del.owner]) {
                snapshot.skills[del.owner] = snapshot.skills[del.owner].filter(s => s.name !== del.name);
                if (!snapshot.skills[del.owner].length) delete snapshot.skills[del.owner];
            }
        }
        // Danh tiếng: Hợp nhất mục chi tiết của người dùng, lọc bỏ các phân loại đã xóa
        const repConfig = rpgMeta.reputationConfig || { categories: [], _deletedCategories: [] };
        const validRepNames = new Set((repConfig.categories || []).map(c => c.name));
        const deletedRepNames = new Set(repConfig._deletedCategories || []);
        const userRep = rpgMeta.reputation || {};
        for (const [owner, cats] of Object.entries(userRep)) {
            if (!snapshot.reputation[owner]) snapshot.reputation[owner] = {};
            for (const [catName, data] of Object.entries(cats)) {
                if (deletedRepNames.has(catName) || !validRepNames.has(catName)) continue;
                if (!snapshot.reputation[owner][catName]) {
                    snapshot.reputation[owner][catName] = { ...data };
                } else {
                    snapshot.reputation[owner][catName].subItems = data.subItems || {};
                }
            }
        }
        // Xóa các phân loại danh tiếng đã bị xóa khỏi ảnh chụp nhanh
        for (const [owner, cats] of Object.entries(snapshot.reputation)) {
            for (const catName of Object.keys(cats)) {
                if (deletedRepNames.has(catName) || !validRepNames.has(catName)) {
                    delete cats[catName];
                }
            }
            if (!Object.keys(cats).length) delete snapshot.reputation[owner];
        }
        snapshot.reputationConfig = repConfig;
        // Trang bị: Lọc các ô đã xóa theo nhân vật
        for (const [owner, slots] of Object.entries(snapshot.equipment)) {
            const ownerCfg = _eqPerChar[owner];
            if (!ownerCfg || !Array.isArray(ownerCfg.slots)) continue;
            const validEqSlots = new Set(ownerCfg.slots.map(s => s.name));
            const deletedEqSlots = new Set(ownerCfg._deletedSlots || []);
            for (const slotName of Object.keys(slots)) {
                if (deletedEqSlots.has(slotName) || (validEqSlots.size > 0 && !validEqSlots.has(slotName))) {
                    delete slots[slotName];
                }
            }
            if (!Object.keys(slots).length) delete snapshot.equipment[owner];
        }
        snapshot.equipmentConfig = _eqCfg;
        // Cấu hình tiền tệ
        snapshot.currencyConfig = rpgMeta.currencyConfig || { denominations: [] };
        return snapshot;
    }

    /** Hợp nhất dữ liệu mối quan hệ vào chat[0].horae_meta */
    _mergeRelationships(newRels) {
        const chat = this.getChat();
        if (!chat?.length || !newRels?.length) return;
        const firstMsg = chat[0];
        if (!firstMsg.horae_meta) firstMsg.horae_meta = createEmptyMeta();
        if (!firstMsg.horae_meta.relationships) firstMsg.horae_meta.relationships = [];
        const existing = firstMsg.horae_meta.relationships;
        for (const rel of newRels) {
            const idx = existing.findIndex(r => r.from === rel.from && r.to === rel.to);
            if (idx >= 0) {
                if (existing[idx]._userEdited) continue;
                existing[idx].type = rel.type;
                if (rel.note) existing[idx].note = rel.note;
            } else {
                existing.push({ ...rel });
            }
        }
    }

    /** Xây dựng lại mạng lưới quan hệ của chat[0] từ tất cả các tin nhắn (dùng để đẩy ngược lại sau khi chỉnh sửa/xóa) */
    rebuildRelationships() {
        const chat = this.getChat();
        if (!chat?.length) return;
        const firstMsg = chat[0];
        if (!firstMsg.horae_meta) firstMsg.horae_meta = createEmptyMeta();
        // Giữ lại các mối quan hệ do người dùng chỉnh sửa thủ công, phần còn lại xây dựng lại
        const userEdited = (firstMsg.horae_meta.relationships || []).filter(r => r._userEdited);
        firstMsg.horae_meta.relationships = [...userEdited];
        for (let i = 1; i < chat.length; i++) {
            const rels = chat[i]?.horae_meta?.relationships;
            if (rels?.length) this._mergeRelationships(rels);
        }
    }

    /** Xây dựng lại ký ức cảnh vật của chat[0] từ tất cả các tin nhắn (dùng để đẩy ngược lại sau khi chỉnh sửa/xóa/tạo lại) */
    rebuildLocationMemory() {
        const chat = this.getChat();
        if (!chat?.length) return;
        const firstMsg = chat[0];
        if (!firstMsg.horae_meta) firstMsg.horae_meta = createEmptyMeta();
        const existing = firstMsg.horae_meta.locationMemory || {};
        const rebuilt = {};
        const deletedNames = new Set();
        // Giữ lại các mục do người dùng tạo/chỉnh sửa thủ công, ghi nhận các mục đã xóa
        for (const [name, info] of Object.entries(existing)) {
            if (info._deleted) {
                deletedNames.add(name);
                rebuilt[name] = { ...info };
                continue;
            }
            if (info._userEdited) rebuilt[name] = { ...info };
        }
        // Phát lại scene_desc do AI ghi từ tin nhắn (theo trình tự thời gian, ghi sau đè ghi trước), bỏ qua các mục đã xóa/do người dùng chỉnh sửa
        for (let i = 1; i < chat.length; i++) {
            const meta = chat[i]?.horae_meta;
            const pairs = meta?.scene?._descPairs;
            if (pairs?.length > 0) {
                for (const p of pairs) {
                    if (deletedNames.has(p.location)) continue;
                    if (rebuilt[p.location]?._userEdited) continue;
                    rebuilt[p.location] = {
                        desc: p.desc,
                        firstSeen: rebuilt[p.location]?.firstSeen || new Date().toISOString(),
                        lastUpdated: new Date().toISOString()
                    };
                }
            } else if (meta?.scene?.scene_desc && meta?.scene?.location) {
                const loc = meta.scene.location;
                if (deletedNames.has(loc)) continue;
                if (rebuilt[loc]?._userEdited) continue;
                rebuilt[loc] = {
                    desc: meta.scene.scene_desc,
                    firstSeen: rebuilt[loc]?.firstSeen || new Date().toISOString(),
                    lastUpdated: new Date().toISOString()
                };
            }
        }
        firstMsg.horae_meta.locationMemory = rebuilt;
    }

    getRelationships() {
        const chat = this.getChat();
        return chat?.[0]?.horae_meta?.relationships || [];
    }

    /** Đặt mạng lưới quan hệ (khi người dùng chỉnh sửa thủ công) */
    setRelationships(relationships) {
        const chat = this.getChat();
        if (!chat?.length) return;
        const firstMsg = chat[0];
        if (!firstMsg.horae_meta) firstMsg.horae_meta = createEmptyMeta();
        firstMsg.horae_meta.relationships = relationships;
    }

    /** Lấy các mối quan hệ liên quan đến nhân vật được chỉ định (trả về mảng rỗng khi không có nhân vật nào có mặt) */
    getRelationshipsForCharacters(charNames) {
        if (!charNames?.length) return [];
        const rels = this.getRelationships();
        const nameSet = new Set(charNames);
        return rels.filter(r => nameSet.has(r.from) || nameSet.has(r.to));
    }

    /** Xóa toàn cục các việc cần làm đã hoàn thành */
    removeCompletedAgenda(deletedTexts) {
        const chat = this.getChat();
        if (!chat || deletedTexts.length === 0) return;

        const isMatch = (agendaText, deleteText) => {
            if (!agendaText || !deleteText) return false;
            // Khớp chính xác hoặc chứa lẫn nhau (cho phép AI viết tắt/mở rộng)
            return agendaText === deleteText ||
                   agendaText.includes(deleteText) ||
                   deleteText.includes(agendaText);
        };

        if (chat[0]?.horae_meta?.agenda) {
            chat[0].horae_meta.agenda = chat[0].horae_meta.agenda.filter(
                a => !deletedTexts.some(dt => isMatch(a.text, dt))
            );
        }

        for (let i = 1; i < chat.length; i++) {
            if (chat[i]?.horae_meta?.agenda?.length > 0) {
                chat[i].horae_meta.agenda = chat[i].horae_meta.agenda.filter(
                    a => !deletedTexts.some(dt => isMatch(a.text, dt))
                );
            }
        }
    }

    /** Ghi/cập nhật ký ức cảnh vật vào chat[0] */
    _updateLocationMemory(locationName, desc) {
        const chat = this.getChat();
        if (!chat?.length || !locationName || !desc) return;
        const firstMsg = chat[0];
        if (!firstMsg.horae_meta) firstMsg.horae_meta = createEmptyMeta();
        if (!firstMsg.horae_meta.locationMemory) firstMsg.horae_meta.locationMemory = {};
        const mem = firstMsg.horae_meta.locationMemory;
        const now = new Date().toISOString();

        // Loại bỏ trùng lặp địa điểm cấp con: Nếu phần "nằm ở" của mô tả cấp con lặp lại thông tin địa lý của cấp cha, thì tự động rút gọn
        const sepMatch = locationName.match(/[·・\-\/\|]/);
        if (sepMatch) {
            const parentName = locationName.substring(0, sepMatch.index).trim();
            const parentEntry = mem[parentName];
            if (parentEntry?.desc) {
                desc = this._deduplicateChildDesc(desc, parentEntry.desc, parentName);
            }
        }

        if (mem[locationName]) {
            if (mem[locationName]._userEdited || mem[locationName]._deleted) return;
            mem[locationName].desc = desc;
            mem[locationName].lastUpdated = now;
        } else {
            mem[locationName] = { desc, firstSeen: now, lastUpdated: now };
        }
        console.log(`[Horae] Ký ức cảnh vật đã được cập nhật: ${locationName}`);
    }

    /**
     * Loại bỏ trùng lặp mô tả cấp con: Phát hiện xem mô tả cấp con có chứa thông tin vị trí địa lý của cấp cha hay không, nếu có thì thay thế bằng vị trí tương đối
     */
    _deduplicateChildDesc(childDesc, parentDesc, parentName) {
        if (!childDesc || !parentDesc) return childDesc;
        // Trích xuất phần "nằm ở" của cấp cha
        const parentLocMatch = parentDesc.match(/^Nằm ở(.+?)[。\.]/);
        if (!parentLocMatch) return childDesc;
        const parentLocInfo = parentLocMatch[1].trim();
        // Nếu mô tả cấp con cũng chứa các từ khóa vị trí địa lý của cấp cha (trùng khớp quá nửa số từ), thì coi là dư thừa
        const parentKeywords = parentLocInfo.replace(/[，,、của]/g, ' ').split(/\s+/).filter(k => k.length >= 2);
        if (parentKeywords.length === 0) return childDesc;
        const childLocMatch = childDesc.match(/^Nằm ở(.+?)[。\.]/);
        if (!childLocMatch) return childDesc;
        const childLocInfo = childLocMatch[1].trim();
        let matchCount = 0;
        for (const kw of parentKeywords) {
            if (childLocInfo.includes(kw)) matchCount++;
        }
        // Hơn một nửa từ khóa trùng khớp, xác định cấp con đã sao chép vị trí địa lý của cấp cha
        if (matchCount >= Math.ceil(parentKeywords.length / 2)) {
            const shortName = parentName.length > 4 ? parentName.substring(0, 4) + '…' : parentName;
            const restDesc = childDesc.substring(childLocMatch[0].length).trim();
            return `Nằm bên trong ${shortName}. ${restDesc}`;
        }
        return childDesc;
    }

    /** Lấy ký ức cảnh vật */
    getLocationMemory() {
        const chat = this.getChat();
        return chat?.[0]?.horae_meta?.locationMemory || {};
    }

    /**
     * Khớp thông minh ký ức cảnh vật (Hỗ trợ địa danh phức hợp)
     * Mức ưu tiên: Khớp chính xác → Tách và quay lui về cấp cha → Suy luận ngữ cảnh → Từ bỏ
     */
    _findLocationMemory(currentLocation, locMem, previousLocation = '') {
        if (!currentLocation || !locMem || Object.keys(locMem).length === 0) return null;

        const tag = (name) => ({ ...locMem[name], _matchedName: name });

        if (locMem[currentLocation]) return tag(currentLocation);

        // Khớp tên từng gọi: Kiểm tra mảng _aliases của tất cả các mục
        for (const [name, info] of Object.entries(locMem)) {
            if (info._aliases?.includes(currentLocation)) return tag(name);
        }

        const SEP = /[·・\-\/|]/;
        const parts = currentLocation.split(SEP).map(s => s.trim()).filter(Boolean);

        if (parts.length > 1) {
            for (let i = parts.length - 1; i >= 1; i--) {
                const partial = parts.slice(0, i).join('·');
                if (locMem[partial]) return tag(partial);
                for (const [name, info] of Object.entries(locMem)) {
                    if (info._aliases?.includes(partial)) return tag(name);
                }
            }
        }

        if (previousLocation) {
            const prevParts = previousLocation.split(SEP).map(s => s.trim()).filter(Boolean);
            const prevParent = prevParts[0] || previousLocation;
            const curParent = parts[0] || currentLocation;

            if (prevParent !== curParent && prevParent.includes(curParent)) {
                if (locMem[prevParent]) return tag(prevParent);
            }
        }

        return null;
    }

    /**
     * Lấy dữ liệu thẻ hiện tại của bảng toàn cục (per-card overlay)
     * Cấu trúc bảng toàn cục (Tiêu đề, tên, từ khóa nhắc nhở, khóa) được dùng chung, dữ liệu được tách riêng theo thẻ nhân vật
     */
    _getResolvedGlobalTables() {
        const templates = this.settings?.globalTables || [];
        const chat = this.getChat();
        if (!chat?.[0] || templates.length === 0) return [];

        const firstMsg = chat[0];
        if (!firstMsg.horae_meta) firstMsg.horae_meta = createEmptyMeta();
        if (!firstMsg.horae_meta.globalTableData) firstMsg.horae_meta.globalTableData = {};
        const perCardData = firstMsg.horae_meta.globalTableData;

        const result = [];
        for (const template of templates) {
            const name = (template.name || '').trim();
            if (!name) continue;

            if (!perCardData[name]) {
                // Sử dụng lần đầu ở thẻ này: Khởi tạo từ mẫu (Bao gồm di chuyển dữ liệu cũ)
                const initData = JSON.parse(JSON.stringify(template.data || {}));
                perCardData[name] = {
                    data: initData,
                    rows: template.rows || 2,
                    cols: template.cols || 2,
                    baseData: JSON.parse(JSON.stringify(initData)),
                    baseRows: template.rows || 2,
                    baseCols: template.cols || 2,
                };
            } else {
                // Đồng bộ tiêu đề bảng của mẫu toàn cục vào per-card (Người dùng có thể đã sửa tiêu đề ở nơi khác)
                const templateData = template.data || {};
                for (const key of Object.keys(templateData)) {
                    const [r, c] = key.split('-').map(Number);
                    if (r === 0 || c === 0) {
                        perCardData[name].data[key] = templateData[key];
                    }
                }
            }

            const overlay = perCardData[name];
            result.push({
                name: template.name,
                prompt: template.prompt,
                lockedRows: template.lockedRows || [],
                lockedCols: template.lockedCols || [],
                lockedCells: template.lockedCells || [],
                data: overlay.data,
                rows: overlay.rows,
                cols: overlay.cols,
                baseData: overlay.baseData,
                baseRows: overlay.baseRows,
                baseCols: overlay.baseCols,
            });
        }
        return result;
    }

    /** Xử lý phản hồi của AI, phân tích nhãn dán và lưu trữ siêu dữ liệu */
    processAIResponse(messageIndex, messageContent) {
        // Dựa trên các thẻ bị loại trừ do người dùng cấu hình, gỡ bỏ toàn bộ các khối tùy chỉnh như kịch nhỏ, ngăn chặn các thẻ horae bên trong chúng làm ô nhiễm việc phân tích văn bản chính
        const cleanedContent = this._stripCustomTags(messageContent, this.settings?.vectorStripTags);
        let parsed = this.parseHoraeTag(cleanedContent);
        
        // Khi phân tích thẻ thất bại, tự động lùi về (fallback) phân tích theo định dạng nới lỏng
        if (!parsed) {
            parsed = this.parseLooseFormat(cleanedContent);
            if (parsed) {
                console.log(`[Horae] #${messageIndex} Không phát hiện thấy nhãn dán, đã trích xuất dữ liệu qua phân tích nới lỏng`);
            }
        }
        
        if (parsed) {
            const existingMeta = this.getMessageMeta(messageIndex);
            const newMeta = this.mergeParsedToMeta(existingMeta, parsed);
            
            // Xử lý cập nhật bảng
            if (newMeta._tableUpdates) {
                // Ghi lại sự đóng góp cho bảng, dùng để khôi phục
                newMeta.tableContributions = newMeta._tableUpdates;
                this.applyTableUpdates(newMeta._tableUpdates);
                delete newMeta._tableUpdates;
            }
            
            // Xử lý các việc cần làm đã được AI đánh dấu hoàn thành
            if (parsed.deletedAgenda && parsed.deletedAgenda.length > 0) {
                this.removeCompletedAgenda(parsed.deletedAgenda);
            }

            // Ký ức cảnh vật: Lưu scene_desc vào locationMemory (Hỗ trợ ghép nối nhiều bối cảnh trong cùng một phản hồi)
            const descPairs = parsed.scene?._descPairs;
            if (descPairs?.length > 0) {
                for (const p of descPairs) {
                    this._updateLocationMemory(p.location, p.desc);
                }
            } else if (parsed.scene?.scene_desc && parsed.scene?.location) {
                this._updateLocationMemory(parsed.scene.location, parsed.scene.scene_desc);
            }
            
            // Mạng lưới quan hệ: Hợp nhất vào chat[0].horae_meta.relationships
            if (parsed.relationships && parsed.relationships.length > 0) {
                this._mergeRelationships(parsed.relationships);
            }
            
            this.setMessageMeta(messageIndex, newMeta);
            
            // Dữ liệu RPG: Hợp nhất vào chat[0].horae_meta.rpg
            if (newMeta._rpgChanges) {
                this._mergeRpgData(newMeta._rpgChanges);
            }
            return true;
        } else {
            // Không có nhãn, tạo siêu dữ liệu trống
            if (!this.getMessageMeta(messageIndex)) {
                this.setMessageMeta(messageIndex, createEmptyMeta());
            }
            return false;
        }
    }

    /**
     * Phân tích trường NPC
     * Định dạng: Tên|Ngoại hình=Tính cách@Quan hệ~Giới tính:Nam~Tuổi:25~Chủng tộc:Loài người~Nghề nghiệp:Lính đánh thuê~Bổ sung:xxx
     */
    _parseNpcFields(npcStr) {
        const info = {};
        if (!npcStr) return { _name: '' };
        
        // 1. Tách các trường mở rộng
        const tildeParts = npcStr.split('~');
        const mainPart = tildeParts[0].trim(); // Tên|Ngoại hình=Tính cách@Quan hệ
        
        for (let i = 1; i < tildeParts.length; i++) {
            const kv = tildeParts[i].trim();
            if (!kv) continue;
            const colonIdx = kv.indexOf(':');
            if (colonIdx <= 0) continue;
            const key = kv.substring(0, colonIdx).trim();
            const value = kv.substring(colonIdx + 1).trim();
            if (!value) continue;
            
            // Khớp từ khóa
            if (/^(Giới tính|gender|sex)$/i.test(key)) info.gender = value;
            else if (/^(Tuổi|age|tuổi tác)$/i.test(key)) info.age = value;
            else if (/^(Chủng tộc|race|tộc người|chủng loài)$/i.test(key)) info.race = value;
            else if (/^(Nghề nghiệp|job|class|chức vụ|thân phận)$/i.test(key)) info.job = value;
            else if (/^(Ngày sinh|birthday|birth)$/i.test(key)) info.birthday = value;
            else if (/^(Bổ sung|note|ghi chú|khác)$/i.test(key)) info.note = value;
        }
        
        // 2. Phân tích phần thân
        let name = '';
        const pipeIdx = mainPart.indexOf('|');
        if (pipeIdx > 0) {
            name = mainPart.substring(0, pipeIdx).trim();
            const descPart = mainPart.substring(pipeIdx + 1).trim();
            
            const hasNewFormat = descPart.includes('=') || descPart.includes('@');
            
            if (hasNewFormat) {
                const atIdx = descPart.indexOf('@');
                let beforeAt = atIdx >= 0 ? descPart.substring(0, atIdx) : descPart;
                const relationship = atIdx >= 0 ? descPart.substring(atIdx + 1).trim() : '';
                
                const eqIdx = beforeAt.indexOf('=');
                const appearance = eqIdx >= 0 ? beforeAt.substring(0, eqIdx).trim() : beforeAt.trim();
                const personality = eqIdx >= 0 ? beforeAt.substring(eqIdx + 1).trim() : '';
                
                if (appearance) info.appearance = appearance;
                if (personality) info.personality = personality;
                if (relationship) info.relationship = relationship;
            } else {
                const parts = descPart.split('|').map(s => s.trim());
                if (parts[0]) info.appearance = parts[0];
                if (parts[1]) info.personality = parts[1];
                if (parts[2]) info.relationship = parts[2];
            }
        } else {
            name = mainPart.trim();
        }
        
        info._name = name;
        return info;
    }

    /**
     * Phân tích dữ liệu ô của bảng biểu
     * Định dạng: Mỗi hàng một ô 1,1:Nội dung hoặc một hàng nhiều ô phân cách bằng |
     */
    _parseTableCellEntries(text) {
        const updates = {};
        if (!text) return updates;
        
        const cellRegex = /^(\d+)[,\-](\d+)[:：]\s*(.*)$/;
        
        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            
            // Tách bằng |
            const segments = trimmed.split(/\s*[|｜]\s*/);
            
            for (const seg of segments) {
                const s = seg.trim();
                if (!s) continue;
                
                const m = s.match(cellRegex);
                if (m) {
                    const r = parseInt(m[1]);
                    const c = parseInt(m[2]);
                    const value = m[3].trim();
                    // Lọc các nhãn trống
                    if (value && !/^[\(\（]?trống[\)\）]?$/.test(value) && !/^[-—]+$/.test(value)) {
                        updates[`${r}-${c}`] = value;
                    }
                }
            }
        }
        
        return updates;
    }

    /** Ghi cập nhật bảng vào chat[0] (Bảng cục bộ) hoặc per-card overlay (Bảng toàn cục) */
    applyTableUpdates(tableUpdates) {
        if (!tableUpdates || tableUpdates.length === 0) return;

        const chat = this.getChat();
        if (!chat || chat.length === 0) return;

        const firstMsg = chat[0];
        if (!firstMsg.horae_meta) firstMsg.horae_meta = createEmptyMeta();
        if (!firstMsg.horae_meta.customTables) firstMsg.horae_meta.customTables = [];

        const localTables = firstMsg.horae_meta.customTables;
        const resolvedGlobal = this._getResolvedGlobalTables();

        for (const update of tableUpdates) {
            const updateName = (update.name || '').trim();
            let table = localTables.find(t => (t.name || '').trim() === updateName);
            let isGlobal = false;
            if (!table) {
                table = resolvedGlobal.find(t => (t.name || '').trim() === updateName);
                isGlobal = true;
            }
            if (!table) {
                console.warn(`[Horae] Bảng biểu "${updateName}" không tồn tại, bỏ qua`);
                continue;
            }

            if (!table.data) table.data = {};
            const lockedRows = new Set(table.lockedRows || []);
            const lockedCols = new Set(table.lockedCols || []);
            const lockedCells = new Set(table.lockedCells || []);

            // Ảnh chụp nhanh do người dùng chỉnh sửa: Xóa tất cả các ô dữ liệu trước, sau đó ghi vào toàn bộ
            if (update._isUserEdit) {
                for (const key of Object.keys(table.data)) {
                    const [r, c] = key.split('-').map(Number);
                    if (r >= 1 && c >= 1) delete table.data[key];
                }
            }

            let updatedCount = 0;
            let blockedCount = 0;

            for (const [key, value] of Object.entries(update.updates)) {
                const [r, c] = key.split('-').map(Number);

                // Người dùng chỉnh sửa không bị bảo vệ bởi tiêu đề và giới hạn khóa
                if (!update._isUserEdit) {
                    if (r === 0 || c === 0) {
                        const existing = table.data[key];
                        if (existing && existing.trim()) continue;
                    }

                    if (lockedRows.has(r) || lockedCols.has(c) || lockedCells.has(key)) {
                        blockedCount++;
                        continue;
                    }
                }

                table.data[key] = value;
                updatedCount++;

                if (r + 1 > (table.rows || 2)) table.rows = r + 1;
                if (c + 1 > (table.cols || 2)) table.cols = c + 1;
            }

            // Bảng toàn cục: Đồng bộ thay đổi kích thước về lại per-card overlay
            if (isGlobal) {
                const perCardData = firstMsg.horae_meta?.globalTableData;
                if (perCardData?.[updateName]) {
                    perCardData[updateName].rows = table.rows;
                    perCardData[updateName].cols = table.cols;
                }
            }

            if (blockedCount > 0) {
                console.log(`[Horae] Bảng biểu "${updateName}" đã chặn sửa đổi ở ${blockedCount} ô bị khóa`);
            }
            console.log(`[Horae] Bảng biểu "${updateName}" đã cập nhật ${updatedCount} ô`);
        }
    }

    /** Xây dựng lại dữ liệu bảng (Đảm bảo tính nhất quán sau khi xóa/sửa tin nhắn) */
    rebuildTableData(maxIndex = -1) {
        const chat = this.getChat();
        if (!chat || chat.length === 0) return;
        
        const firstMsg = chat[0];
        const limit = maxIndex >= 0 ? Math.min(maxIndex + 1, chat.length) : chat.length;

        // Công cụ hỗ trợ: Đặt lại một bảng biểu về baseData
        const resetTable = (table) => {
            if (table.baseData) {
                table.data = JSON.parse(JSON.stringify(table.baseData));
            } else {
                if (!table.data) { table.data = {}; return; }
                const keysToDelete = [];
                for (const key of Object.keys(table.data)) {
                    const [r, c] = key.split('-').map(Number);
                    if (r >= 1 && c >= 1) keysToDelete.push(key);
                }
                for (const key of keysToDelete) delete table.data[key];
            }
            if (table.baseRows !== undefined) {
                table.rows = table.baseRows;
            } else if (table.baseData) {
                let calcRows = 2, calcCols = 2;
                for (const key of Object.keys(table.baseData)) {
                    const [r, c] = key.split('-').map(Number);
                    if (r === 0 && c + 1 > calcCols) calcCols = c + 1;
                    if (c === 0 && r + 1 > calcRows) calcRows = r + 1;
                }
                table.rows = calcRows;
                table.cols = calcCols;
            }
            if (table.baseCols !== undefined) {
                table.cols = table.baseCols;
            }
        };

        // 1a. Đặt lại bảng cục bộ
        const localTables = firstMsg.horae_meta?.customTables || [];
        for (const table of localTables) {
            resetTable(table);
        }

        // 1b. Đặt lại per-card overlay của bảng toàn cục
        const perCardData = firstMsg.horae_meta?.globalTableData || {};
        for (const overlay of Object.values(perCardData)) {
            resetTable(overlay);
        }
        
        // 2. Quét trước: Tìm chỉ mục tin nhắn chứa _isUserEdit cuối cùng của mỗi bảng
        const lastUserEditIdx = new Map();
        for (let i = 0; i < limit; i++) {
            const meta = chat[i]?.horae_meta;
            if (meta?.tableContributions) {
                for (const tc of meta.tableContributions) {
                    if (tc._isUserEdit) {
                        lastUserEditIdx.set((tc.name || '').trim(), i);
                    }
                }
            }
        }

        // 3. Phát lại tableContributions theo trình tự tin nhắn (Cắt đứt ở giới hạn (limit))
        // Phòng thủ: Nếu một bảng nào đó có ảnh chụp nhanh của người dùng chỉnh sửa, hãy bỏ qua tất cả các đóng góp của AI trước ảnh chụp nhanh đó
        let totalApplied = 0;
        for (let i = 0; i < limit; i++) {
            const meta = chat[i]?.horae_meta;
            if (meta?.tableContributions && meta.tableContributions.length > 0) {
                const filtered = meta.tableContributions.filter(tc => {
                    if (tc._isUserEdit) return true;
                    const name = (tc.name || '').trim();
                    const ueIdx = lastUserEditIdx.get(name);
                    if (ueIdx !== undefined && i <= ueIdx) return false;
                    return true;
                });
                if (filtered.length > 0) {
                    this.applyTableUpdates(filtered);
                    totalApplied++;
                }
            }
        }
        
        console.log(`[Horae] Dữ liệu bảng biểu đã được xây dựng lại, đã phát lại đóng góp bảng của ${totalApplied} tin nhắn (Đến #${limit - 1})`);
    }

    /** Quét và tiêm vào lịch sử trò chuyện */
    async scanAndInjectHistory(progressCallback, analyzeCallback = null) {
        const chat = this.getChat();
        let processed = 0;
        let skipped = 0;

        // Cần giữ lại các trường liên quan đến toàn cục/tóm tắt khi ghi đè meta
        const PRESERVE_KEYS = [
            'autoSummaries', 'customTables', 'globalTableData',
            'locationMemory', 'relationships', 'tableContributions'
        ];

        for (let i = 0; i < chat.length; i++) {
            const message = chat[i];
            
            if (message.is_user) {
                skipped++;
                if (progressCallback) {
                    progressCallback(Math.round((i + 1) / chat.length * 100), i + 1, chat.length);
                }
                continue;
            }

            // Bỏ qua siêu dữ liệu đã có
            const hasEvents = message.horae_meta?.events?.length > 0 || message.horae_meta?.event?.summary;
            if (message.horae_meta && (
                message.horae_meta.timestamp?.story_date ||
                hasEvents ||
                Object.keys(message.horae_meta.costumes || {}).length > 0
            )) {
                skipped++;
                if (progressCallback) {
                    progressCallback(Math.round((i + 1) / chat.length * 100), i + 1, chat.length);
                }
                continue;
            }

            // Giữ lại dữ liệu toàn cục và các dấu hiệu sự kiện trên meta đã có
            const existing = message.horae_meta;
            const preserved = {};
            if (existing) {
                for (const key of PRESERVE_KEYS) {
                    if (existing[key] !== undefined) preserved[key] = existing[key];
                }
                // Giữ lại các dấu hiệu tóm tắt trên sự kiện (_compressedBy / _summaryId)
                if (existing.events?.length > 0) preserved._existingEvents = existing.events;
            }

            const parsed = this.parseHoraeTag(message.mes);
            
            if (parsed) {
                const meta = this.mergeParsedToMeta(null, parsed);
                if (meta._tableUpdates) {
                    meta.tableContributions = meta._tableUpdates;
                    delete meta._tableUpdates;
                }
                // Khôi phục các trường được giữ lại
                Object.assign(meta, preserved);
                delete meta._existingEvents;
                this.setMessageMeta(i, meta);
                processed++;
            } else if (analyzeCallback) {
                try {
                    const analyzed = await analyzeCallback(message.mes);
                    if (analyzed) {
                        const meta = this.mergeParsedToMeta(null, analyzed);
                        if (meta._tableUpdates) {
                            meta.tableContributions = meta._tableUpdates;
                            delete meta._tableUpdates;
                        }
                        Object.assign(meta, preserved);
                        delete meta._existingEvents;
                        this.setMessageMeta(i, meta);
                        processed++;
                    }
                } catch (error) {
                    console.error(`[Horae] Phân tích tin nhắn #${i} thất bại:`, error);
                }
            } else {
                const meta = createEmptyMeta();
                Object.assign(meta, preserved);
                delete meta._existingEvents;
                this.setMessageMeta(i, meta);
                processed++;
            }

            if (progressCallback) {
                progressCallback(Math.round((i + 1) / chat.length * 100), i + 1, chat.length);
            }
        }

        return { processed, skipped };
    }

    generateSystemPromptAddition() {
        const userName = this.context?.name1 || 'Nhân vật chính';
        const charName = this.context?.name2 || 'Nhân vật';
        
        if (this.settings?.customSystemPrompt) {
            const custom = this.settings.customSystemPrompt
                .replace(/\{\{user\}\}/gi, userName)
                .replace(/\{\{char\}\}/gi, charName);
            return custom + this.generateLocationMemoryPrompt() + this.generateCustomTablesPrompt() + this.generateRelationshipPrompt() + this.generateMoodPrompt() + this.generateRpgPrompt();
        }
        
        const sceneDescLine = this.settings?.sendLocationMemory ? '\nscene_desc:Đặc điểm vật lý cố định của địa điểm (Xem quy tắc ký ức bối cảnh, chỉ viết khi kích hoạt)' : '';
        const relLine = this.settings?.sendRelationships ? '\nrel:Nhân vật A>Nhân vật B=Loại quan hệ|Ghi chú (Xem quy tắc mạng lưới quan hệ, chỉ viết khi kích hoạt)' : '';
        const moodLine = this.settings?.sendMood ? '\nmood:Tên nhân vật=Cảm xúc/Trạng thái tâm lý (Xem quy tắc theo dõi cảm xúc, chỉ viết khi kích hoạt)' : '';
        return `
【Hệ thống ký ức Horae】 (Ví dụ dưới đây chỉ để minh họa, không dùng nguyên văn vào trong văn bản chính!)

═══ Nguyên tắc cốt lõi: Định hướng bởi sự thay đổi ═══
★★★ Trước khi viết thẻ <horae>, hãy phán đoán xem ở lượt này có những thông tin nào xảy ra thay đổi thực chất ★★★
  ① Cơ sở bối cảnh (time/location/characters/costume) → Bắt buộc điền ở mỗi lượt
  ② Tất cả các trường khác → Tuân thủ nghiêm ngặt【Điều kiện kích hoạt】của từng trường, nếu không có thay đổi thì hoàn toàn không viết dòng đó
  ③ Các NPC/vật phẩm đã được ghi chép nếu không có thông tin mới → Cấm xuất ra! Lặp lại dữ liệu không thay đổi = lãng phí token
  ④ Chỉ một phần trường thay đổi → Sử dụng cập nhật tăng dần, chỉ viết phần có thay đổi
  ⑤ NPC xuất hiện lần đầu → Bắt buộc phải viết cả hai dòng npc: và affection:!

═══ Định dạng thẻ ═══
Cuối mỗi lần trả lời bắt buộc phải ghi vào hai thẻ:
<horae>
time:Ngày tháng Thời gian (Bắt buộc)
location:Địa điểm (Bắt buộc. Các địa điểm đa cấp được phân cách bằng dấu chấm giữa, ví dụ「Quán rượu·Đại sảnh」「Hoàng cung·Phòng ngai vàng」. Cùng một địa điểm phải sử dụng tên hoàn toàn nhất quán trong mỗi lần viết)
atmosphere:Bầu không khí${sceneDescLine}
characters:Tên các nhân vật có mặt, phân cách bằng dấu phẩy (Bắt buộc)
costume:Tên nhân vật=Mô tả trang phục (Bắt buộc, mỗi người một dòng, cấm gộp bằng dấu chấm phẩy)
item/item!/item!!:Xem quy tắc vật phẩm (Chỉ viết khi kích hoạt)
item-:Tên vật phẩm (Xóa khi vật phẩm bị tiêu hao/đánh mất. Xem quy tắc vật phẩm, chỉ viết khi kích hoạt)
affection:Tên nhân vật=Độ hảo cảm (★ Bắt buộc điền giá trị ban đầu khi NPC xuất hiện lần đầu! Sau đó chỉ cập nhật khi độ hảo cảm thay đổi)
npc:Tên nhân vật|Ngoại hình=Tính cách@Quan hệ~Trường mở rộng (★ Bắt buộc điền đầy đủ thông tin khi NPC xuất hiện lần đầu! Sau đó chỉ cập nhật khi có thay đổi)
agenda:Ngày tháng|Nội dung (Chỉ viết khi có việc cần làm mới được kích hoạt)
agenda-:Từ khóa nội dung (Chỉ viết khi việc cần làm đã hoàn thành/hết hạn, hệ thống sẽ tự động gỡ bỏ việc cần làm khớp)${relLine}${moodLine}
</horae>
<horaeevent>
event:Mức độ quan trọng|Tóm tắt sự kiện (30-50 chữ, mức độ quan trọng: Bình thường/Quan trọng/Quan trọng (Chìa khóa), ghi lại tóm tắt sự kiện trong tin nhắn này, dùng để truy xuất cốt truyện)
</horaeevent>

═══ 【Vật phẩm】 Điều kiện kích hoạt và Quy tắc ═══
Tham khảo số ID (#ID) trong [Danh sách vật phẩm], tuân thủ nghiêm ngặt các điều kiện dưới đây để quyết định có xuất ra hay không.

【Khi nào thì viết】 (Đáp ứng bất kỳ điều kiện nào mới xuất ra)
  ✦ Nhận được vật phẩm mới → item:/item!:/item!!:
  ✦ Số lượng/Quyền sở hữu/Vị trí/Tính chất của vật phẩm đã có xảy ra thay đổi → item: (Chỉ viết phần thay đổi)
  ✦ Vật phẩm bị tiêu hao/đánh mất/dùng hết → item-:Tên vật phẩm
【Khi nào không viết】
  ✗ Vật phẩm không có bất kỳ thay đổi nào → Cấm xuất ra bất kỳ dòng item nào
  ✗ Vật phẩm chỉ được nhắc đến nhưng không có sự thay đổi trạng thái → Không viết

【Định dạng】
  Mới nhận được: item:emojiTên vật phẩm(Số lượng)|Mô tả=Người nắm giữ@Vị trí chính xác (Có thể bỏ qua trường mô tả. Trừ phi vật phẩm đó mang ý nghĩa đặc biệt, như món quà, đồ lưu niệm, thì thêm mô tả)
  Mới nhận được (Quan trọng): item!:emojiTên vật phẩm(Số lượng)|Mô tả=Người nắm giữ@Vị trí chính xác (Vật phẩm quan trọng, bắt buộc có mô tả: Ngoại hình+Chức năng+Nguồn gốc)
  Mới nhận được (Then chốt): item!!:emojiTên vật phẩm(Số lượng)|Mô tả=Người nắm giữ@Vị trí chính xác (Đạo cụ then chốt, mô tả bắt buộc phải chi tiết)
  Vật phẩm đã có thay đổi: item:emojiTên vật phẩm(Số lượng mới)=Người nắm giữ mới@Vị trí mới (Chỉ cập nhật phần thay đổi, không viết | thì giữ nguyên mô tả ban đầu)
  Tiêu hao/Đánh mất: item-:Tên vật phẩm

【Quy tắc cấp trường】
  · Mô tả: Ghi lại thuộc tính bản chất của vật phẩm (Ngoại hình/Chức năng/Nguồn gốc), vật phẩm bình thường có thể bỏ qua, vật phẩm quan trọng/then chốt bắt buộc điền ở lần đầu
    ★ Đặc điểm ngoại hình (Màu sắc, chất liệu, kích thước v.v., để thuận tiện cho việc miêu tả nhất quán sau này)
    ★ Chức năng/Công dụng
    ★ Nguồn gốc (Ai đưa/Làm sao có được)
       - Ví dụ (Nếu có ví dụ trong phần nội dung dưới đây thì chỉ để minh họa, không dùng nguyên văn vào trong văn bản chính!):
         - Ví dụ 1: item!:🌹Bó hoa vĩnh cửu|Hoa hồng đỏ thẫm vĩnh cửu, được buộc bằng dải ruy băng đen, món quà Valentine C tặng U=U@Trên bàn làm việc trong phòng U
         - Ví dụ 2: item!:🎫Vé quay mười lần may mắn|Chiếc vé giấy lấp lánh ánh vàng, phúc lợi cho người mới có thể thực hiện một lần quay mười lần tại vòng quay hệ thống=U@Nhẫn không gian
         - Ví dụ 3: item!!:🏧Máy đổi tiền tệ các vị diện tự động|Trông giống một chiếc máy ATM cỡ nhỏ, có thể đổi tiền tệ của các vị diện theo tỷ giá tức thời=U@Quầy bar quán rượu
  · Số lượng: Món đồ đơn lẻ không viết (1)/(1 cái)/(1 chiếc) v.v., chỉ khi là đơn vị đo lường mới viết trong ngoặc như (5 cân)(1L)(1 thùng)
  · Vị trí: Bắt buộc phải là địa điểm cố định chính xác
    ❌ Trên mặt đất trước mặt ai đó, Dưới chân ai đó, Bên cạnh ai đó, Sàn nhà, Trên bàn
    ✅ Sàn đại sảnh quán rượu, Trên quầy bar nhà hàng, Phòng bếp trong nhà, Trong ba lô, Trên bàn trong phòng U
  · Cấm tính các đồ nội thất cố định và các thiết bị kiến trúc vào danh sách vật phẩm
  · Việc cho mượn tạm thời không đồng nghĩa với chuyển giao quyền sở hữu


Ví dụ (Vòng đời của Bia lúa mạch):
  Nhận được: item:🍺Bia lúa mạch ủ lâu năm(50L)|Bia lúa mạch tìm thấy trong phòng chứa đồ, có vị chua chát=U@Tủ nguyên liệu bếp sau quán rượu
  Thay đổi lượng: item:🍺Bia lúa mạch ủ lâu năm(25L)=U@Tủ nguyên liệu bếp sau quán rượu
  Dùng hết: item-:Bia lúa mạch ủ lâu năm

═══ 【NPC】 Điều kiện kích hoạt và Quy tắc ═══
Định dạng: npc:Tên|Ngoại hình=Tính cách@Mối quan hệ với {{user}}~Giới tính:Giá trị~Tuổi:Giá trị~Chủng tộc:Giá trị~Nghề nghiệp:Giá trị~Ngày sinh:Giá trị
Ký tự phân cách: | Phân tách tên, = Phân tách ngoại hình và tính cách, @ Phân tách quan hệ, ~ Phân tách các trường mở rộng (key:value)

【Khi nào thì viết】 (Đáp ứng bất kỳ điều kiện nào mới xuất ra dòng npc: của NPC đó)
  ✦ Lần đầu xuất hiện → Định dạng hoàn chỉnh, tất cả các trường + tất cả các trường mở rộng ~ (Giới tính/Tuổi/Chủng tộc/Nghề nghiệp), không thể thiếu phần nào
  ✦ Ngoại hình thay đổi vĩnh viễn (như bị thương để lại sẹo, đổi kiểu tóc, thay đổi cách ăn mặc) → Chỉ viết trường ngoại hình
  ✦ Tính cách thay đổi (như sau khi trải qua một sự kiện lớn tính cách bị thay đổi) → Chỉ viết trường tính cách
  ✦ Mối quan hệ với {{user}} thay đổi (như từ khách hàng thành bạn bè) → Chỉ viết trường quan hệ
  ✦ Nhận được thông tin mới về NPC đó (những thông tin chưa biết trước đây như chiều cao/cân nặng v.v.) → Bổ sung vào trường tương ứng
  ✦ Bản thân trường mở rộng ~ xảy ra thay đổi (như đổi nghề nghiệp) → Chỉ viết trường mở rộng ~ có sự thay đổi
【Khi nào không viết】
  ✗ NPC có mặt nhưng không có thông tin mới → Cấm viết dòng npc:
  ✗ NPC tạm thời rời đi sau đó quay lại, thông tin không thay đổi → Cấm viết lại
  ✗ Muốn dùng từ đồng nghĩa/viết tắt để viết lại mô tả đã có → Nghiêm cấm!
    ❌ "Cơ bắp phát triển/Đầy vết thương chiến đấu"→"Cơ bắp cường tráng/Sẹo" (Đổi từ ≠ Cập nhật)
    ✅ "Cơ bắp phát triển/Đầy vết thương chiến đấu/Bị thương nặng"→"Cơ bắp phát triển/Đầy vết thương chiến đấu" (Vết thương đã khỏi, loại bỏ trạng thái lỗi thời)

【Ví dụ cập nhật tăng dần】 (Lấy NPC Vol làm ví dụ)
  Lần đầu: npc:Vol|Lông màu xám bạc/Mắt xanh lục/Cao 220cm/Đầy vết thương chiến đấu=Ít nói trầm mặc@Khách hàng đầu tiên của {{user}}~Giới tính:Nam~Tuổi:Khoảng 35~Chủng tộc:Lang nhân~Nghề nghiệp:Lính đánh thuê
  Chỉ cập nhật quan hệ: npc:Vol|=@Bạn trai của {{user}}
  Chỉ bổ sung ngoại hình: npc:Vol|Lông màu xám bạc/Mắt xanh lục/Cao 220cm/Đầy vết thương chiến đấu/Tay trái quấn băng
  Chỉ cập nhật tính cách: npc:Vol|=Không còn trầm mặc/Thỉnh thoảng mỉm cười
  Chỉ đổi nghề: npc:Vol|~Nghề nghiệp:Lính đánh thuê giải nghệ
(Lưu ý: Không viết các trường và trường mở rộng ~ không bị thay đổi! Hệ thống sẽ tự động giữ lại dữ liệu ban đầu!)

【Trường Ngày sinh (Trường mở rộng tùy chọn)】
  Định dạng: ~Ngày sinh:yyyy/mm/dd Hoặc ~Ngày sinh:mm/dd (Chỉ viết tháng ngày khi không có năm)
  ⚠ Chỉ viết trường này khi thiết lập nhân vật/mô tả nhân vật đề cập rõ ràng đến ngày sinh! Nghiêm cấm suy đoán hoặc bịa đặt!
  ⚠ Ngày sinh không có nguồn gốc rõ ràng, tuyệt đối không viết trường này——Hãy để trống để người dùng tự điền.

【Quy định mô tả mối quan hệ】
  Bắt buộc phải bao gồm tên đối tượng và phải chính xác: ❌Khách hàng ✅Khách ghé thăm mới của {{user}} / ❌Chủ nợ ✅Người giữ giấy nợ của {{user}} / ❌Chủ nhà ✅Chủ nhà của {{user}} / ❌Bạn trai ✅Bạn trai của {{user}} / ❌Ân nhân ✅Người đã cứu mạng {{user}} / ❌Kẻ bắt nạt ✅Kẻ bắt nạt {{user}} / ❌Người thầm thương ✅Người thầm thương {{user}} / ❌Kẻ thù ✅Bị {{user}} giết chết cha đẻ
  Các mối quan hệ phụ thuộc cần ghi rõ tên NPC chủ: ✅Chó săn của Ivan; Thú cưng của khách của {{user}} / Bạn gái của Ivan; Khách của {{user}} / Bạn thân của {{user}}; Vợ của Ivan / Cha dượng của {{user}}; Cha của Ivan / Nhân tình của {{user}}; Em trai của Ivan / Bạn thân của {{user}}; Tình nhân của chồng {{user}}; Người thứ ba xen vào mối quan hệ vợ chồng của {{user}} và Ivan

═══ 【Độ hảo cảm】 Điều kiện kích hoạt ═══
Chỉ ghi chép độ hảo cảm của NPC đối với {{user}} (Cấm ghi chép của chính {{user}}). Mỗi người một dòng, cấm thêm chú thích sau giá trị số.

【Khi nào thì viết】
  ✦ NPC xuất hiện lần đầu → Dựa theo mối quan hệ để quyết định giá trị khởi điểm (Người lạ 0-20/Người quen 30-50/Bạn bè 50-70/Người yêu 70-90)
  ✦ Tương tác dẫn đến thay đổi thực chất về độ hảo cảm → affection:Tên=Tổng giá trị mới
【Khi nào không viết】
  ✗ Độ hảo cảm không thay đổi → Không viết

═══ 【Việc cần làm】 Điều kiện kích hoạt ═══
【Khi nào thì viết (Thêm mới)】
  ✦ Trong cốt truyện xuất hiện những cuộc hẹn/kế hoạch/lịch trình/nhiệm vụ/sự kiện ngầm mới → agenda:Ngày tháng|Nội dung
  Định dạng: agenda:Ngày lập|Nội dung (Thời gian mang tính tương đối phải chú thích ngày tháng tuyệt đối trong ngoặc)
  Ví dụ: agenda:2026/02/10|Alan mời {{user}} hẹn hò vào buổi tối Lễ Tình nhân(2026/02/14 18:00)
【Khi nào thì viết (Xóa khi hoàn thành) — Vô cùng quan trọng!】
  ✦ Việc cần làm đã hoàn thành/đã hết hạn/đã bị hủy → Bắt buộc phải dùng agenda-: để đánh dấu xóa
  Định dạng: agenda-:Nội dung việc cần làm (Chỉ cần điền các từ khóa nội dung của sự kiện đã hoàn thành là có thể tự động gỡ bỏ)
  Ví dụ: agenda-:Alan mời {{user}} hẹn hò vào buổi tối Lễ Tình nhân
  ⚠ Nghiêm cấm sử dụng các cách thức như agenda:Nội dung(Đã hoàn thành)! Bắt buộc phải dùng tiền tố agenda-: !
  ⚠ Nghiêm cấm lặp lại việc ghi lại các nội dung công việc cần làm đã tồn tại!
【Khi nào không viết】
  ✗ Các công việc cần làm đã tồn tại không có gì thay đổi → Cấm lặp lại các công việc cần làm đã có trong mỗi lượt
  ✗ Công việc cần làm đã hoàn thành → Cấm dùng agenda: có thêm ngoặc để đánh dấu là hoàn thành, phải dùng agenda-:

═══ Quy định về định dạng thời gian ═══
Nghiêm cấm các định dạng không rõ ràng như "Day 1"/"Ngày thứ X", bắt buộc sử dụng ngày tháng trên lịch cụ thể.
- Hiện đại: Năm/Tháng/Ngày Giờ:Phút (ví dụ 2026/2/4 15:00)
- Lịch sử: Ngày tháng của niên đại đó (ví dụ 1920/3/15 14:00)
- Kỳ ảo/Giả tưởng: Lịch của bối cảnh thế giới đó (ví dụ Ngày thứ ba tháng Sương Giáng Lúc hoàng hôn)

═══ Nhắc nhở bắt buộc cuối cùng ═══
Cuối dòng trả lời của bạn bắt buộc phải chứa hai thẻ <horae>...</horae> và <horaeevent>...</horaeevent>.
Thiếu bất kỳ thẻ nào = Không đạt yêu cầu.

【Các trường bắt buộc viết trong mỗi lượt——Thiếu bất kỳ một mục nào = Không đạt yêu cầu!】
  ✅ time: ← Ngày giờ hiện tại
  ✅ location: ← Địa điểm hiện tại
  ✅ atmosphere: ← Bầu không khí
  ✅ characters: ← Tên của tất cả các nhân vật hiện đang có mặt, cách nhau bằng dấu phẩy (Tuyệt đối không được bỏ sót!)
  ✅ costume: ← Mỗi nhân vật có mặt một dòng miêu tả trang phục
  ✅ event: ← Mức độ quan trọng|Tóm tắt sự kiện

【Khi NPC xuất hiện lần đầu phải viết thêm——Không thể thiếu bất kỳ mục nào!】
  ✅ npc:Tên|Ngoại hình=Tính cách@Quan hệ~Giới tính:Giá trị~Tuổi:Giá trị~Chủng tộc:Giá trị~Nghề nghiệp:Giá trị~Ngày sinh:Giá trị(Chỉ viết khi đã biết, không biết thì không viết)
  ✅ affection:Tên NPC đó=Độ hảo cảm ban đầu（Người lạ 0-20/Người quen 30-50/Bạn bè 50-70/Người yêu 70-90）

Không có trường hợp "Có thể viết hoặc không" đối với các trường trên——Chúng mang tính bắt buộc.`;
    }

    getDefaultTablesPrompt() {
        return `═══ Quy định về Bảng biểu Tùy chỉnh ═══
Ở phía trên có các bảng biểu tùy chỉnh do người dùng thiết lập, hãy điền dữ liệu dựa theo "Yêu cầu điền".
★ Định dạng: Trong thẻ <horaetable:Tên bảng biểu>, mỗi hàng là một ô dữ liệu → Hàng,Cột:Nội dung
★★ Chú giải tọa độ: Hàng 0 và Cột 0 là phần tiêu đề, dữ liệu bắt đầu từ 1,1. Số hàng = Số thứ tự của hàng dữ liệu, Số cột = Số thứ tự của cột dữ liệu
★★★ Nguyên tắc điền ★★★
  - Đối với các ô dữ liệu trống nhưng trong cốt truyện đã có thông tin tương ứng → Bắt buộc phải điền! Đừng bỏ sót!
  - Nội dung đã có và không thay đổi → Không cần viết lại
  - Cốt truyện không đề cập đến thông tin tương ứng cho hàng/cột đó → Để trống
  - Nghiêm cấm xuất ra các ký tự thay thế như "(Trống)""-""Không có"
  - Hàng/Cột có ký hiệu 🔒 là dữ liệu chỉ đọc, cấm chỉnh sửa nội dung bên trong
  - Khi thêm hàng mới, xin thêm sau số hàng lớn nhất hiện tại; khi thêm cột mới, xin thêm sau số cột lớn nhất hiện tại`;
    }

    getDefaultLocationPrompt() {
        return `═══ 【Ký ức Bối cảnh】 Điều kiện Kích hoạt ═══
Định dạng: scene_desc:Nằm ở…. Mô tả các đặc điểm vật lý cố định của địa điểm đó (50-150 chữ)
Ký ức bối cảnh ghi lại cấu trúc cốt lõi và những đặc điểm mang tính vĩnh viễn (Cấu trúc tòa nhà, nội thất cố định, điểm nổi bật về không gian) của địa điểm, dùng để duy trì tính nhất quán khi mô tả bối cảnh ở các lượt chơi khác nhau.

【Định dạng Địa điểm / Nằm ở】★★★ Tuân thủ nghiêm ngặt quy tắc phân cấp ★★★
  · Bắt đầu đoạn mô tả, hãy viết từ「Nằm ở」để chỉ ra hướng/vị trí của địa điểm đó so với địa điểm trực tiếp cấp trên, sau đó mới viết các đặc điểm vật lý của chính địa điểm đó
  · Địa điểm cấp con (Tên địa điểm chứa dấu phân cách ·): Phần「Nằm ở」chỉ ghi vị trí tương đối bên trong tòa nhà cấp cha (Ví dụ ở tầng nào, hướng nào), nghiêm cấm bao gồm vị trí địa lý bên ngoài của cấp cha
  · Địa điểm cấp cha/Cấp cao nhất: Phần「Nằm ở」mới ghi vị trí địa lý bên ngoài (Ví dụ ở lục địa nào, cạnh khu rừng nào)
  · Hệ thống sẽ tự động gửi kèm mô tả cấp cha cho AI, cấp con không cần và không nên lặp lại thông tin của cấp cha
    ✓ Quán rượu Vô danh·Phòng 203 → scene_desc:Nằm ở tầng 2 phía Đông. Là phòng góc, đón ánh sáng tốt, giường đơn bằng gỗ dựa vào tường, cửa sổ hướng Đông
    ✓ Quán rượu Vô danh·Đại sảnh → scene_desc:Nằm ở tầng 1. Không gian làm bằng gỗ với trần cao, chính giữa là quầy bar dài, xung quanh rải rác vài chiếc bàn tròn
    ✓ Quán rượu Vô danh → scene_desc:Nằm ở rìa khu rừng XX thuộc miền Bắc lục địa OO. Kiến trúc hai tầng bằng gỗ và đá, tầng một là đại sảnh và quầy bar, tầng hai là khu phòng khách
    ✗ Quán rượu Vô danh·Phòng 203 → scene_desc:Nằm ở tầng 2 của Quán rượu Vô danh ở rìa khu rừng XX thuộc miền Bắc lục địa OO…(❌ Cấp con không được phép ghi thông tin địa lý bên ngoài của cấp cha)
    ✗ Quán rượu Vô danh·Đại sảnh → scene_desc:Nằm ở tầng 1 của Quán rượu Vô danh ở rìa khu rừng…(❌ Tương tự như trên)
【Quy định về Tên địa điểm】
  · Các địa điểm đa cấp được phân cách bằng dấu ·: Tòa nhà·Khu vực (Ví dụ「Quán rượu Vô danh·Đại sảnh」「Hoàng cung·Phòng ngai vàng」)
  · Cùng một địa điểm phải luôn luôn sử dụng cái tên hoàn toàn giống với [Bối cảnh|...] ở bên trên, cấm viết tắt hoặc thay đổi
  · Các khu vực có cùng tên nhưng ở các tòa nhà khác nhau thì được ghi nhận riêng biệt (Ví dụ「Quán rượu Vô danh·Đại sảnh」và「Hoàng cung·Đại sảnh」là hai địa điểm khác nhau)
【Khi nào viết】
  ✦ Lần đầu tiên đến một địa điểm mới → Bắt buộc viết scene_desc, mô tả đặc điểm vật lý cố định của địa điểm đó
  ✦ Địa điểm có sự thay đổi vật lý vĩnh viễn (Ví dụ: bị phá hủy, được trang hoàng lại) → Viết scene_desc sau khi cập nhật
【Khi nào không viết】
  ✗ Quay lại địa điểm cũ đã được ghi chép và không có thay đổi về mặt vật lý → Không viết
  ✗ Bầu không khí/Thời tiết/Mùa thay đổi → Không viết (Đây là những thay đổi tạm thời, không phải đặc điểm cố định)
【Quy định về Mô tả】
  · Chỉ miêu tả những đặc điểm vật lý cố định/vĩnh viễn: Cấu trúc không gian, vật liệu kiến trúc, nội thất cố định, hướng cửa sổ, đồ trang trí mang tính biểu tượng
  · Không miêu tả các trạng thái tạm thời: Ánh sáng hiện tại, thời tiết, đám đông, đồ trang trí theo mùa, vật dụng được đặt tạm
  · Nghiêm cấm bê nguyên văn ký ức bối cảnh vào chính văn, hãy dùng nó làm tài liệu tham khảo bối cảnh, và mô tả lại dựa trên góc nhìn của nhân vật/thời gian/thời tiết/ánh sáng hiện tại
  · Mục [Ký ức bối cảnh|...] ở phía trên là các đặc điểm của địa điểm mà hệ thống đã ghi lại, hãy giữ nguyên những yếu tố cốt lõi này khi mô tả bối cảnh đó, đồng thời tự do sáng tạo thêm các chi tiết dựa theo thời gian/mùa/cốt truyện`;
    }

    generateLocationMemoryPrompt() {
        if (!this.settings?.sendLocationMemory) return '';
        const custom = this.settings?.customLocationPrompt;
        if (custom) {
            const userName = this.context?.name1 || 'Nhân vật chính';
            const charName = this.context?.name2 || 'Nhân vật';
            return '\n' + custom.replace(/\{\{user\}\}/gi, userName).replace(/\{\{char\}\}/gi, charName);
        }
        return '\n' + this.getDefaultLocationPrompt();
    }

    generateCustomTablesPrompt() {
        const chat = this.getChat();
        const firstMsg = chat?.[0];
        const localTables = firstMsg?.horae_meta?.customTables || [];
        const resolvedGlobal = this._getResolvedGlobalTables();
        const allTables = [...resolvedGlobal, ...localTables];
        if (allTables.length === 0) return '';

        let prompt = '\n' + (this.settings?.customTablesPrompt || this.getDefaultTablesPrompt());

        // Tạo ví dụ có tọa độ cho mỗi bảng biểu
        for (const table of allTables) {
            const tableName = table.name || 'Bảng biểu tùy chỉnh';
            const rows = table.rows || 2;
            const cols = table.cols || 2;
            prompt += `\n★ Kích thước của Bảng biểu「${tableName}」：${rows - 1} hàng × ${cols - 1} cột (Số hàng của khu vực dữ liệu là 1-${rows - 1}，số cột là 1-${cols - 1})`;
            prompt += `\nVí dụ (Điền vào các ô dữ liệu trống hoặc cập nhật các ô có sự thay đổi):
<horaetable:${tableName}>
1,1:Nội dung A
1,2:Nội dung B
2,1:Nội dung C
</horaetable>`;
            break;
        }

        return prompt;
    }

    getDefaultRelationshipPrompt() {
        const userName = this.context?.name1 || '{{user}}';
        return `═══ 【Mạng lưới Quan hệ】 Điều kiện Kích hoạt ═══
Định dạng: rel:Nhân vật A>Nhân vật B=Loại quan hệ|Ghi chú
Hệ thống sẽ tự động lưu lại và hiển thị mạng lưới quan hệ giữa các nhân vật, kết xuất khi mối quan hệ giữa các nhân vật có sự thay đổi.

【Khi nào viết】 (Thỏa mãn bất kỳ điều kiện nào thì mới được kết xuất)
  ✦ Thiết lập/Định hình mối quan hệ mới giữa hai nhân vật → rel:Nhân vật A>Nhân vật B=Loại quan hệ
  ✦ Mối quan hệ hiện tại có sự thay đổi (Ví dụ: Từ đồng nghiệp thành bạn bè) → rel:Nhân vật A>Nhân vật B=Loại quan hệ mới
  ✦ Cần bổ sung các thông tin chi tiết quan trọng về mối quan hệ → Thêm |Ghi chú
【Khi nào không viết】
  ✗ Mối quan hệ không thay đổi → Không viết
  ✗ Mối quan hệ đã được lưu nhưng không có bản cập nhật nào → Không viết

【Quy định】
  · Bắt buộc phải dùng tên gọi đầy đủ chính xác của cả Nhân vật A và Nhân vật B
  · Loại quan hệ được mô tả bằng từ ngữ súc tích: Bạn bè, Người yêu, Cấp trên/Cấp dưới, Sư đồ, Kẻ thù truyền kiếp, Đối tác hợp tác, v.v.
  · Tùy chọn sử dụng trường ghi chú, dùng để lưu giữ các chi tiết đặc biệt về mối quan hệ
  · Các mối quan hệ liên quan đến ${userName} cũng phải được ghi lại
  Ví dụ:
    rel:${userName}>Vol=Quan hệ thuê mướn|${userName} mở quán rượu, Vol là khách quen
    rel:Vol>Ella=Yêu thầm|Vol có tình cảm với Ella nhưng chưa thổ lộ
    rel:${userName}>Ella=Bạn thân`;
    }

    getDefaultMoodPrompt() {
        return `═══ 【Theo dõi Cảm xúc/Trạng thái tâm lý】 Điều kiện Kích hoạt ═══
Định dạng: mood:Tên nhân vật=Trạng thái cảm xúc (Các cụm từ ngắn gọn, ví dụ "Căng thẳng/Bất an", "Vui vẻ/Mong đợi", "Tức giận", "Bình tĩnh nhưng cảnh giác")
Hệ thống sẽ theo dõi những thay đổi trong cảm xúc của các nhân vật có mặt, giúp duy trì tính liền mạch trong trạng thái tâm lý của nhân vật.

【Khi nào viết】 (Đáp ứng bất kỳ điều kiện nào thì mới được xuất ra)
  ✦ Cảm xúc của nhân vật có sự thay đổi rõ rệt (Ví dụ: Từ bình tĩnh chuyển sang tức giận) → mood:Tên nhân vật=Cảm xúc mới
  ✦ Khi nhân vật xuất hiện lần đầu tiên và có nét cảm xúc rõ ràng → mood:Tên nhân vật=Cảm xúc hiện tại
【Khi nào không viết】
  ✗ Cảm xúc của nhân vật không có sự thay đổi → Không viết
  ✗ Nhân vật không có mặt → Không viết
【Quy định】
  · Sử dụng từ 1-4 từ cho mỗi mô tả cảm xúc, phân tách các cảm xúc phức hợp bằng dấu /
  · Chỉ ghi chép cảm xúc của những nhân vật có mặt`;
    }

    generateRelationshipPrompt() {
        if (!this.settings?.sendRelationships) return '';
        const custom = this.settings?.customRelationshipPrompt;
        if (custom) {
            const userName = this.context?.name1 || 'Nhân vật chính';
            const charName = this.context?.name2 || 'Nhân vật';
            return '\n' + custom.replace(/\{\{user\}\}/gi, userName).replace(/\{\{char\}\}/gi, charName);
        }
        return '\n' + this.getDefaultRelationshipPrompt();
    }

    _generateAntiParaphrasePrompt() {
        if (!this.settings?.antiParaphraseMode) return '';
        const userName = this.context?.name1 || 'Nhân vật chính';
        return `
═══ Chế độ Chống tường thuật (Anti-Paraphrase) ═══
Người dùng hiện đang dùng lối viết phản tường thuật: Hành động/Lời thoại của ${userName} được tự mô tả bởi chính ${userName} ở trong phần tin nhắn USER, bạn (AI) không còn phải nhắc lại phần của ${userName} nữa.
Vì thế, khi soạn nhãn dán <horae> ở lượt này, bạn phải kết hợp cả những diễn biến diễn ra trong "Tin nhắn USER ngay sát trước câu trả lời này" vào quá trình kết toán:
  ✦ Thu thập/Tiêu hao vật phẩm xuất hiện trong tin nhắn USER → Viết vào dòng item:/item-: tương ứng
  ✦ Chuyển cảnh xuất hiện trong tin nhắn USER → Cập nhật location:
  ✦ Thay đổi mức độ hảo cảm/Tương tác với NPC xuất hiện trong tin nhắn USER → Cập nhật affection:
  ✦ Cốt truyện được thúc đẩy trong tin nhắn USER → Gộp chung để khái quát vào trong <horaeevent>
  ✦ Tóm lại: Thẻ <horae> này phải bao trùm toàn bộ sự thay đổi ở cả hai phần "Tin nhắn của USER ở lượt trước" và "Câu trả lời hiện tại của AI"
`;
    }

    generateMoodPrompt() {
        if (!this.settings?.sendMood) return '';
        const custom = this.settings?.customMoodPrompt;
        if (custom) {
            const userName = this.context?.name1 || 'Nhân vật chính';
            const charName = this.context?.name2 || 'Nhân vật';
            return '\n' + custom.replace(/\{\{user\}\}/gi, userName).replace(/\{\{char\}\}/gi, charName);
        }
        return '\n' + this.getDefaultMoodPrompt();
    }

    /** Từ khóa nhắc nhở RPG (Chỉ được tiêm khi tính năng rpgMode kích hoạt) */
    generateRpgPrompt() {
        if (!this.settings?.rpgMode) return '';
        // Ưu tiên từ khóa nhắc nhở tùy chỉnh
        if (this.settings.customRpgPrompt) {
            return '\n' + this.settings.customRpgPrompt
                .replace(/\{\{user\}\}/gi, this.context?.name1 || 'Nhân vật chính')
                .replace(/\{\{char\}\}/gi, this.context?.name2 || 'AI');
        }
        return '\n' + this.getDefaultRpgPrompt();
    }

    /** Từ khóa nhắc nhở mặc định RPG */
    getDefaultRpgPrompt() {
        const sendBars = this.settings?.sendRpgBars !== false;
        const sendSkills = this.settings?.sendRpgSkills !== false;
        const sendAttrs = this.settings?.sendRpgAttributes !== false;
        const sendEq = !!this.settings?.sendRpgEquipment;
        const sendRep = !!this.settings?.sendRpgReputation;
        const sendLvl = !!this.settings?.sendRpgLevel;
        const sendCur = !!this.settings?.sendRpgCurrency;
        const sendSh = !!this.settings?.sendRpgStronghold;
        if (!sendBars && !sendSkills && !sendAttrs && !sendEq && !sendRep && !sendLvl && !sendCur && !sendSh) return '';
        const userName = this.context?.name1 || 'Nhân vật chính';
        const uoBars = !!this.settings?.rpgBarsUserOnly;
        const uoSkills = !!this.settings?.rpgSkillsUserOnly;
        const uoAttrs = !!this.settings?.rpgAttrsUserOnly;
        const uoEq = !!this.settings?.rpgEquipmentUserOnly;
        const uoRep = !!this.settings?.rpgReputationUserOnly;
        const uoLvl = !!this.settings?.rpgLevelUserOnly;
        const uoCur = !!this.settings?.rpgCurrencyUserOnly;
        const anyUo = uoBars || uoSkills || uoAttrs || uoEq || uoRep || uoLvl || uoCur;
        const allUo = uoBars && uoSkills && uoAttrs && uoEq && uoRep && uoLvl && uoCur;
        const barCfg = this.settings?.rpgBarConfig || [
            { key: 'hp', name: 'HP' }, { key: 'mp', name: 'MP' }, { key: 'sp', name: 'SP' }
        ];
        const attrCfg = this.settings?.rpgAttributeConfig || [];
        let p = `═══ 【RPG】 ═══\nCuối dòng trả lời của bạn phải có nhãn <horaerpg> .`;
        if (allUo) {
            p += `Tất cả dữ liệu RPG chỉ theo dõi riêng một mình ${userName}, định dạng sẽ không chứa trường sở hữu. Nghiêm cấm việc xuất dữ liệu RPG cho các NPC.\n`;
        } else if (anyUo) {
            p += `Định dạng về quyền sở hữu tương tự như số định danh NPC: N Số định danh Tên gọi đầy đủ, ${userName} chỉ cần viết tên trực tiếp không có tiền tố N. Một vài mô-đun chỉ theo dõi ${userName} (Sẽ được chú thích ở phía dưới).\n`;
        } else {
            p += `Định dạng về quyền sở hữu tương tự như số định danh NPC: N Số định danh Tên gọi đầy đủ, ${userName} chỉ cần viết tên trực tiếp không có tiền tố N.\n`;
        }
        if (sendBars) {
            p += `\n【Các thanh thuộc tính——Phải được ghi trong mỗi lượt, Nếu thiếu=Không đạt!】\n`;
            if (uoBars) {
                p += `Chỉ cần ghi các thanh thuộc tính cùng trạng thái của ${userName}:\n`;
                for (const bar of barCfg) {
                    p += `  ✅ ${bar.key}:Hiện tại/Tối đa(${bar.name})  ← Lần đầu tiên phải ghi tên hiển thị\n`;
                }
                p += `  ✅ status:Hiệu ứng 1/Hiệu ứng 2  ← Không có điểm bất thường nào thì ghi Bình thường\n`;
            } else {
                p += `Phải xuất trạng thái và tất cả các thanh thuộc tính cho từng nhân vật có mặt được nhắc tới ở mục characters:\n`;
                for (const bar of barCfg) {
                    p += `  ✅ ${bar.key}:Chủ sở hữu=Hiện tại/Tối đa(${bar.name})  ← Lần đầu tiên phải ghi tên hiển thị\n`;
                }
                p += `  ✅ status:Chủ sở hữu=Hiệu ứng 1/Hiệu ứng 2  ← Không có điểm bất thường nào thì ghi =Bình thường\n`;
            }
            p += `Quy tắc:\n`;
            p += `  - Chiến đấu/Chấn thương/Dùng phép/Tiêu thụ → Trừ đi theo mức độ hợp lý; Hồi phục/Nghỉ ngơi → Hồi lại lượng hợp lý\n`;
            if (!uoBars) {
                p += `  - Bắt buộc phải ghi mỗi thanh thuộc tính của mỗi nhân vật hiện diện, thiếu một người=Không đạt\n`;
            }
            p += `  - Nếu giá trị không đổi trong suốt lượt này, vẫn phải viết ra giá trị hiện tại\n`;
        }
        if (sendAttrs && attrCfg.length > 0) {
            p += `\n【Thuộc tính đa chiều】Chỉ viết khi mới ra mắt hoặc giá trị thuộc tính có sự thay đổi, có thể bỏ qua nếu không có sự thay đổi\n`;
            if (uoAttrs) {
                p += `  attr:${attrCfg.map(a => `${a.key}=Giá trị`).join('|')}\n`;
            } else {
                p += `  attr:Chủ sở hữu|${attrCfg.map(a => `${a.key}=Giá trị`).join('|')}\n`;
            }
            p += `  Phạm vi giá trị từ 0-100. Ý nghĩa thuộc tính: ${attrCfg.map(a => `${a.key}(${a.name})`).join('、')}\n`;
        }
        if (sendSkills) {
            p += `\n【Kỹ năng】Chỉ được ghi chép khi Học được/Nâng cấp/Đánh mất, có thể lược bỏ nếu không thay đổi\n`;
            if (uoSkills) {
                p += `  skill:Tên kỹ năng|Cấp độ|Mô tả công năng\n`;
                p += `  skill-:Tên kỹ năng\n`;
            } else {
                p += `  skill:Chủ sở hữu|Tên kỹ năng|Cấp độ|Mô tả công năng\n`;
                p += `  skill-:Chủ sở hữu|Tên kỹ năng\n`;
            }
        }
        if (sendEq) {
            const eqCfg = this._getRpgEquipmentConfig();
            const perChar = eqCfg.perChar || {};
            const present = new Set(this.getLatestState()?.scene?.characters_present || []);
            const hasAnySlots = Object.values(perChar).some(c => c.slots?.length > 0);
            if (hasAnySlots) {
                p += `\n【Trang bị】Chỉ được viết khi nhân vật mặc/cởi bỏ trang bị, có thể lược bỏ nếu không thay đổi\n`;
                if (uoEq) {
                    p += `  equip:Tên ô trang bị|Tên trang bị|Thuộc tính 1=Giá trị,Thuộc tính 2=Giá trị\n`;
                    p += `  unequip:Tên ô trang bị|Tên trang bị\n`;
                    const userCfg = perChar[userName];
                    if (userCfg?.slots?.length) {
                        const slotNames = userCfg.slots.map(s => `${s.name}(×${s.maxCount ?? 1})`).join('、');
                        p += `  Ô trang bị: ${slotNames}\n`;
                    }
                } else {
                    p += `  equip:Chủ sở hữu|Tên ô trang bị|Tên trang bị|Thuộc tính 1=Giá trị,Thuộc tính 2=Giá trị\n`;
                    p += `  unequip:Chủ sở hữu|Tên ô trang bị|Tên trang bị\n`;
                    for (const [owner, cfg] of Object.entries(perChar)) {
                        if (!cfg.slots?.length) continue;
                        if (present.size > 0 && !present.has(owner)) continue;
                        const slotNames = cfg.slots.map(s => `${s.name}(×${s.maxCount ?? 1})`).join('、');
                        p += `  ${owner} Ô trang bị: ${slotNames}\n`;
                    }
                }
                p += `  ⚠ Mọi nhân vật chỉ được sử dụng các ô trang bị đã đăng ký của họ. Các thuộc tính là số nguyên.\n`;
                p += `  ⚠ Các trang phục bình thường không được cường hóa hay sử dụng chất liệu đặc biệt thì không được có chỉ số thuộc tính quá cao.\n`;
            }
        }
        if (sendRep) {
            const repConfig = this._getRpgReputationConfig();
            if (repConfig.categories.length > 0) {
                const catNames = repConfig.categories.map(c => c.name).join('、');
                p += `\n【Danh tiếng】Chỉ được viết khi danh tiếng thay đổi, có thể lược bỏ nếu không thay đổi\n`;
                if (uoRep) {
                    p += `  rep:Tên phân loại danh tiếng=Giá trị hiện tại\n`;
                } else {
                    p += `  rep:Chủ sở hữu|Tên phân loại danh tiếng=Giá trị hiện tại\n`;
                }
                p += `  Danh mục danh tiếng đã ghi nhận: ${catNames}\n`;
                p += `  ⚠ Nghiêm cấm tạo thêm danh mục danh tiếng. Chỉ được sử dụng các tên hạng mục đã đăng ký ở trên.\n`;
            }
        }
        if (sendLvl) {
            p += `\n【Cấp độ và Điểm kinh nghiệm】Chỉ được viết khi thăng/giáng cấp hoặc điểm kinh nghiệm thay đổi, có thể lược bỏ nếu không thay đổi\n`;
            if (uoLvl) {
                p += `  level:Giá trị của cấp độ\n`;
                p += `  xp:Kinh nghiệm hiện tại/Mức cần thiết để lên cấp\n`;
            } else {
                p += `  level:Chủ sở hữu=Giá trị của cấp độ\n`;
                p += `  xp:Chủ sở hữu=Kinh nghiệm hiện tại/Mức cần thiết để lên cấp\n`;
            }
            p += `  Tham khảo cách thu thập điểm kinh nghiệm:\n`;
            p += `  - Khi đương đầu với thử thách khó khăn hay đồng cấp: Được điểm kinh nghiệm lớn(10~50+)\n`;
            p += `  - Khi thử thách quá yếu (Kém ≥10 cấp độ): Chỉ được cộng 1 điểm kinh nghiệm\n`;
            p += `  - Đối thoại/Thám hiểm/Hoạt động thường ngày: Được lượng nhỏ kinh nghiệm(1~5)\n`;
            p += `  - Lượng điểm kinh nghiệm để thăng hạng sẽ tăng lên ứng với mỗi cấp: Đề xuất Điểm kinh nghiệm cần để thăng cấp = Cấp độ × 100\n`;
        }
        if (sendCur) {
            const curConfig = this._getRpgCurrencyConfig();
            if (curConfig.denominations.length > 0) {
                const denomNames = curConfig.denominations.map(d => d.name).join('、');
                p += `\n【Tiền tệ——Bắt buộc ghi lại khi xảy ra hành vi mua bán/thu thập/tiêu pha!】\n`;
                if (uoCur) {
                    p += `Định dạng: currency:Tên tiền tệ=±Lượng thay đổi\n`;
                    p += `Ví dụ:\n`;
                    p += `  currency:${curConfig.denominations[0].name}=+10\n`;
                    p += `  currency:${curConfig.denominations[0].name}=-3\n`;
                    if (curConfig.denominations.length > 1) {
                        p += `  currency:${curConfig.denominations[1].name}=+50\n`;
                    }
                    p += `Cũng có thể dùng giá trị tuyệt đối: currency:Tên tiền tệ=Số lượng\n`;
                } else {
                    p += `Định dạng: currency:Chủ sở hữu|Tên tiền tệ=±Lượng thay đổi\n`;
                    p += `Ví dụ:\n`;
                    p += `  currency:${userName}|${curConfig.denominations[0].name}=+10\n`;
                    p += `  currency:${userName}|${curConfig.denominations[0].name}=-3\n`;
                    if (curConfig.denominations.length > 1) {
                        p += `  currency:${userName}|${curConfig.denominations[1].name}=+50\n`;
                    }
                    p += `Cũng có thể dùng giá trị tuyệt đối: currency:Chủ sở hữu|Tên tiền tệ=Số lượng\n`;
                }
                p += `Đơn vị tiền tệ đã đăng ký: ${denomNames}\n`;
                p += `⚠ Không được phép sử dụng đơn vị tiền chưa đăng ký. Phải có ít nhất một dòng currency với bất kỳ hoạt động nào dính đến tài chính (Giao dịch/Thu thập/Tặng thưởng/Trộm cắp).\n`;
            }
        }
        if (!!this.settings?.sendRpgStronghold) {
            const rpg = this.getChat()?.[0]?.horae_meta?.rpg;
            const nodes = rpg?.strongholds || [];
            p += `\n【Căn cứ/Cứ điểm】Chỉ viết khi tình trạng cứ điểm thay đổi (Nâng cấp/Kiến tạo/Phá hỏng/Đổi mô tả), có thể lược bỏ nếu không thay đổi\n`;
            p += `Định dạng: base:Đường dẫn cứ điểm=Cấp độ hoặc base:Đường dẫn cứ điểm|desc=Mô tả\n`;
            p += `Phân chia hệ thống cấp bậc bằng dấu >\n`;
            p += `Ví dụ:\n`;
            p += `  base:Trang viên của nhân vật chính=3\n`;
            p += `  base:Trang viên của nhân vật chính>Khu rèn>Lò rèn=2\n`;
            p += `  base:Trang viên của nhân vật chính|desc=Trang viên xây bằng đá ở thung lũng, được trang bị tường thành và đài quan sát\n`;
            if (nodes.length > 0) {
                const rootNodes = nodes.filter(n => !n.parent);
                const summary = rootNodes.map(r => {
                    const kids = nodes.filter(n => n.parent === r.id);
                    const kidStr = kids.length > 0 ? `(${kids.map(k => k.name).join('、')})` : '';
                    return `${r.name}${r.level != null ? ' Lv.' + r.level : ''}${kidStr}`;
                }).join('；');
                p += `Cứ điểm hiện tại: ${summary}\n`;
            }
        }
        return p;
    }

    /** Truy xuất thiết lập trang bị của các cuộc hội thoại ở thời điểm hiện tại */
    _getRpgEquipmentConfig() {
        const rpg = this.getChat()?.[0]?.horae_meta?.rpg;
        return rpg?.equipmentConfig || { locked: false, perChar: {} };
    }

    /** Thu thập dữ liệu đánh giá danh tiếng từ đoạn trò chuyện lúc này */
    _getRpgReputationConfig() {
        const rpg = this.getChat()?.[0]?.horae_meta?.rpg;
        return rpg?.reputationConfig || { categories: [], _deletedCategories: [] };
    }

    /** Truy tìm thông tin về đồng tiền từ phiên trò chuyện hiện nay */
    _getRpgCurrencyConfig() {
        const rpg = this.getChat()?.[0]?.horae_meta?.rpg;
        return rpg?.currencyConfig || { denominations: [] };
    }

    /** Tạo chuỗi văn bản cảnh báo động về những thẻ cần được bao gồm (Nếu RPG bật, bổ sung thẻ <horaerpg>) */
    _generateMustTagsReminder() {
        const tags = ['<horae>...</horae>', '<horaeevent>...</horaeevent>'];
        const rpgActive = this.settings?.rpgMode &&
            (this.settings.sendRpgBars !== false || this.settings.sendRpgSkills !== false ||
             this.settings.sendRpgAttributes !== false || !!this.settings.sendRpgReputation ||
             !!this.settings.sendRpgEquipment || !!this.settings.sendRpgLevel || !!this.settings.sendRpgCurrency ||
             !!this.settings.sendRpgStronghold);
        if (rpgActive) tags.push('<horaerpg>...</horaerpg>');
        const count = tags.length === 2 ? 'hai' : `${tags.length} cái`;
        return `Bạn bắt buộc phải đặt ${tags.join(' và ')} vào cuối câu trả lời của mình (Gồm ${count} thẻ).\nNếu thiếu bất kỳ thẻ nào thì câu trả lời sẽ bị cho là không đạt yêu cầu.`;
    }

    /** Trình phân tích Regex linh hoạt (Đoạn text không bị buộc phải nằm giữa thẻ) */
    parseLooseFormat(message) {
        const result = {
            timestamp: {},
            costumes: {},
            items: {},
            deletedItems: [],
            events: [],  // Hỗ trợ lưu trữ nhiều event
            affection: {},
            npcs: {},
            scene: {},
            agenda: [],   // Danh sách điều cần làm
            deletedAgenda: []  // Danh sách điều cần làm đã xong
        };

        let hasAnyData = false;

        const patterns = {
            time: /time[:：]\s*(.+?)(?:\n|$)/gi,
            location: /location[:：]\s*(.+?)(?:\n|$)/gi,
            atmosphere: /atmosphere[:：]\s*(.+?)(?:\n|$)/gi,
            characters: /characters[:：]\s*(.+?)(?:\n|$)/gi,
            costume: /costume[:：]\s*(.+?)(?:\n|$)/gi,
            item: /item(!{0,2})[:：]\s*(.+?)(?:\n|$)/gi,
            itemDelete: /item-[:：]\s*(.+?)(?:\n|$)/gi,
            event: /event[:：]\s*(.+?)(?:\n|$)/gi,
            affection: /affection[:：]\s*(.+?)(?:\n|$)/gi,
            npc: /npc[:：]\s*(.+?)(?:\n|$)/gi,
            agendaDelete: /agenda-[:：]\s*(.+?)(?:\n|$)/gi,
            agenda: /agenda[:：]\s*(.+?)(?:\n|$)/gi
        };

        // time
        let match;
        while ((match = patterns.time.exec(message)) !== null) {
            const timeStr = match[1].trim();
            const clockMatch = timeStr.match(/\b(\d{1,2}:\d{2})\s*$/);
            if (clockMatch) {
                result.timestamp.story_time = clockMatch[1];
                result.timestamp.story_date = timeStr.substring(0, timeStr.lastIndexOf(clockMatch[1])).trim();
            } else {
                result.timestamp.story_date = timeStr;
                result.timestamp.story_time = '';
            }
            hasAnyData = true;
        }

        // location
        while ((match = patterns.location.exec(message)) !== null) {
            result.scene.location = match[1].trim();
            hasAnyData = true;
        }

        // atmosphere
        while ((match = patterns.atmosphere.exec(message)) !== null) {
            result.scene.atmosphere = match[1].trim();
            hasAnyData = true;
        }

        // characters
        while ((match = patterns.characters.exec(message)) !== null) {
            result.scene.characters_present = match[1].trim().split(/[,，]/).map(c => c.trim()).filter(Boolean);
            hasAnyData = true;
        }

        // costume
        while ((match = patterns.costume.exec(message)) !== null) {
            const costumeStr = match[1].trim();
            const eqIndex = costumeStr.indexOf('=');
            if (eqIndex > 0) {
                const char = costumeStr.substring(0, eqIndex).trim();
                const costume = costumeStr.substring(eqIndex + 1).trim();
                result.costumes[char] = costume;
                hasAnyData = true;
            }
        }

        // item
        while ((match = patterns.item.exec(message)) !== null) {
            const exclamations = match[1] || '';
            const itemStr = match[2].trim();
            let importance = '';  // Thường là chuỗi rỗng
            if (exclamations === '!!') importance = '!!';  // Then chốt
            else if (exclamations === '!') importance = '!';  // Quan trọng
            
            const eqIndex = itemStr.indexOf('=');
            if (eqIndex > 0) {
                let itemNamePart = itemStr.substring(0, eqIndex).trim();
                const rest = itemStr.substring(eqIndex + 1).trim();
                
                let icon = null;
                let itemName = itemNamePart;
                const emojiMatch = itemNamePart.match(/^([\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}])/u);
                if (emojiMatch) {
                    icon = emojiMatch[1];
                    itemName = itemNamePart.substring(icon.length).trim();
                }
                
                let description = undefined;  // undefined = Không bị ghi đè thuộc tính description trong quá trình gộp vì không có trường description
                const pipeIdx = itemName.indexOf('|');
                if (pipeIdx > 0) {
                    const descText = itemName.substring(pipeIdx + 1).trim();
                    if (descText) description = descText;  // Cài giá trị này nếu text không trống
                    itemName = itemName.substring(0, pipeIdx).trim();
                }
                
                // Loại bỏ đánh dấu số lượng bị thừa
                itemName = itemName.replace(/[\(（]1[\)）]$/, '').trim();
                itemName = itemName.replace(new RegExp(`[\\(（]1[${COUNTING_CLASSIFIERS}][\\)）]$`), '').trim();
                itemName = itemName.replace(new RegExp(`[\\(（][${COUNTING_CLASSIFIERS}][\\)）]$`), '').trim();
                
                const atIndex = rest.indexOf('@');
                const itemInfo = {
                    icon: icon,
                    importance: importance,
                    holder: atIndex >= 0 ? (rest.substring(0, atIndex).trim() || null) : (rest || null),
                    location: atIndex >= 0 ? (rest.substring(atIndex + 1).trim() || '') : ''
                };
                if (description !== undefined) itemInfo.description = description;
                result.items[itemName] = itemInfo;
                hasAnyData = true;
            }
        }

        // item-
        while ((match = patterns.itemDelete.exec(message)) !== null) {
            const itemName = match[1].trim().replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, '').trim();
            if (itemName) {
                result.deletedItems.push(itemName);
                hasAnyData = true;
            }
        }

        // event
        while ((match = patterns.event.exec(message)) !== null) {
            const eventStr = match[1].trim();
            const parts = eventStr.split('|');
            if (parts.length >= 2) {
                const levelRaw = parts[0].trim();
                const summary = parts.slice(1).join('|').trim();
                
                let level = 'Bình thường';
                if (levelRaw === '关键' || levelRaw.toLowerCase() === 'critical' || levelRaw === 'Quan trọng (Chìa khóa)') {
                    level = 'Quan trọng (Chìa khóa)';
                } else if (levelRaw === '重要' || levelRaw.toLowerCase() === 'important' || levelRaw === 'Quan trọng') {
                    level = 'Quan trọng';
                }
                
                result.events.push({
                    is_important: level === 'Quan trọng' || level === 'Quan trọng (Chìa khóa)',
                    level: level,
                    summary: summary
                });
                hasAnyData = true;
            }
        }

        // affection
        while ((match = patterns.affection.exec(message)) !== null) {
            const affStr = match[1].trim();
            // Định dạng giá trị tuyệt đối
            const absMatch = affStr.match(/^(.+?)=\s*([+\-]?\d+\.?\d*)/);
            if (absMatch) {
                result.affection[absMatch[1].trim()] = { type: 'absolute', value: parseFloat(absMatch[2]) };
                hasAnyData = true;
            } else {
                // Định dạng giá trị tương đối name+/-Số (không có dấu =)
                const relMatch = affStr.match(/^(.+?)([+\-]\d+\.?\d*)/);
                if (relMatch) {
                    result.affection[relMatch[1].trim()] = { type: 'relative', value: relMatch[2] };
                    hasAnyData = true;
                }
            }
        }

        // npc
        while ((match = patterns.npc.exec(message)) !== null) {
            const npcStr = match[1].trim();
            const npcInfo = this._parseNpcFields(npcStr);
            const name = npcInfo._name;
            delete npcInfo._name;
            
            if (name) {
                npcInfo.last_seen = new Date().toISOString();
                result.npcs[name] = npcInfo;
                hasAnyData = true;
            }
        }

        // agenda-: (Cần phải phân tích trước agenda)
        while ((match = patterns.agendaDelete.exec(message)) !== null) {
            const delStr = match[1].trim();
            if (delStr) {
                const pipeIdx = delStr.indexOf('|');
                const text = pipeIdx > 0 ? delStr.substring(pipeIdx + 1).trim() : delStr;
                if (text) {
                    result.deletedAgenda.push(text);
                    hasAnyData = true;
                }
            }
        }

        // agenda
        while ((match = patterns.agenda.exec(message)) !== null) {
            const agendaStr = match[1].trim();
            const pipeIdx = agendaStr.indexOf('|');
            let dateStr = '', text = '';
            if (pipeIdx > 0) {
                dateStr = agendaStr.substring(0, pipeIdx).trim();
                text = agendaStr.substring(pipeIdx + 1).trim();
            } else {
                text = agendaStr;
            }
            if (text) {
                const doneMatch = text.match(/[\(（](hoàn thành|đã hoàn thành|done|finished|completed|hết hiệu lực|hủy|đã hủy)[\)）]\s*$/i);
                if (doneMatch) {
                    const cleanText = text.substring(0, text.length - doneMatch[0].length).trim();
                    if (cleanText) { result.deletedAgenda.push(cleanText); hasAnyData = true; }
                } else {
                    result.agenda.push({ date: dateStr, text, source: 'ai', done: false });
                    hasAnyData = true;
                }
            }
        }

        // Cập nhật bảng
        const tableMatches = [...message.matchAll(/<horaetable[:：]\s*(.+?)>([\s\S]*?)<\/horaetable>/gi)];
        if (tableMatches.length > 0) {
            result.tableUpdates = [];
            for (const tm of tableMatches) {
                const tableName = tm[1].trim();
                const tableContent = tm[2].trim();
                const updates = this._parseTableCellEntries(tableContent);
                
                if (Object.keys(updates).length > 0) {
                    result.tableUpdates.push({ name: tableName, updates });
                    hasAnyData = true;
                }
            }
        }

        return hasAnyData ? result : null;
    }
}

// Xuất Singleton
export const horaeManager = new HoraeManager();