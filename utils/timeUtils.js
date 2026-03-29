/** Horae - Hàm công cụ thời gian */

/** Ánh xạ thứ trong tuần */
const WEEKDAY_NAMES = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/** Tên các mùa */
const SEASONS = ['Mùa đông', 'Mùa đông', 'Mùa xuân', 'Mùa xuân', 'Mùa xuân', 'Mùa hè', 'Mùa hè', 'Mùa hè', 'Mùa thu', 'Mùa thu', 'Mùa thu', 'Mùa đông'];

/** Ánh xạ số tiếng Việt */
const CHINESE_NUMS = {
    'không': 0,
    'một': 1, 'hai': 2, 'ba': 3, 'bốn': 4, 'năm': 5,
    'sáu': 6, 'bảy': 7, 'tám': 8, 'chín': 9, 'mười': 10,
    'mười một': 11, 'mười hai': 12, 'mười ba': 13, 'mười bốn': 14, 'mười lăm': 15,
    'mười sáu': 16, 'mười bảy': 17, 'mười tám': 18, 'mười chín': 19, 'hai mươi': 20,
    'hai mươi mốt': 21, 'hai mươi hai': 22, 'hai mươi ba': 23, 'hai mươi tư': 24, 'hai mươi lăm': 25,
    'hai mươi sáu': 26, 'hai mươi bảy': 27, 'hai mươi tám': 28, 'hai mươi chín': 29, 'ba mươi': 30,
    'ba mươi mốt': 31
};

/** Trích xuất số ngày từ chuỗi ngày tháng */
function extractDayNumber(dateStr) {
    if (!dateStr) return null;
    
    const arabicMatch = dateStr.match(/(?:Ngày thứ|Ngày|Day\s*|day\s*)(\d+)(?: ngày)?/i) ||
                       dateStr.match(/(\d+)(?: ngày|)/i);
    if (arabicMatch) return parseInt(arabicMatch[1]);
    
    // Khớp số tiếng Việt
    const sortedEntries = Object.entries(CHINESE_NUMS).sort((a, b) => b[0].length - a[0].length);
    
    for (const [cn, num] of sortedEntries) {
        const patterns = [
            new RegExp(`Ngày thứ ${cn}`, 'i'),
            new RegExp(`Ngày thứ ${cn}(?![a-zA-Zà-ỹÀ-Ỹ])`, 'i'),  // Ngày thứ X không theo sau bởi chữ cái
            new RegExp(`tháng ${cn} ngày`, 'i'),
            new RegExp(`ngày ${cn}`, 'i')
        ];
        
        for (const pattern of patterns) {
            if (pattern.test(dateStr)) {
                return num;
            }
        }
    }
    
    const anyNumMatch = dateStr.match(/(\d+)/);
    if (anyNumMatch) return parseInt(anyNumMatch[1]);
    
    return null;
}

/** Trích xuất định danh tháng từ chuỗi ngày tháng */
function extractMonthIdentifier(dateStr) {
    if (!dateStr) return null;
    
    // Khớp định dạng "Tháng X"
    const monthMatch = dateStr.match(/([^\s\d]+ tháng)/i) || dateStr.match(/(Tháng [^\s\d]+)/i);
    if (monthMatch) return monthMatch[1];
    
    const numMatch = dateStr.match(/(?:\d{4}[\/\-])?(\d{1,2})[\/\-]\d{1,2}/);
    if (numMatch) return 'Tháng ' + numMatch[1];
    
    return null;
}

/** Phân tích chuỗi ngày tháng cốt truyện */
export function parseStoryDate(dateStr) {
    if (!dateStr) return null;
    
    // Làm sạch đánh dấu thứ trong tuần do AI viết
    let cleanStr = dateStr.trim();
    
    const aiWeekdayMatch = cleanStr.match(/\((Chủ nhật|Thứ Hai|Thứ Ba|Thứ Tư|Thứ Năm|Thứ Sáu|Thứ Bảy)\)/i);
    cleanStr = cleanStr.replace(/\s*\((Chủ nhật|Thứ Hai|Thứ Ba|Thứ Tư|Thứ Năm|Thứ Sáu|Thứ Bảy)\)\s*/gi, ' ').trim();
    
    // Ngày tháng không hợp lệ xử lý theo lịch giả tưởng
    if (/[xX]{2}|[?？]{2}/.test(cleanStr)) {
        return { 
            type: 'fantasy',
            raw: dateStr.trim(),
            aiWeekday: aiWeekdayMatch ? aiWeekdayMatch[1] : undefined
        };
    }
    
    // Định dạng số tiêu chuẩn
    const fullMatch = cleanStr.match(/^(\d{4,})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (fullMatch) {
        const year = parseInt(fullMatch[1]);
        const month = parseInt(fullMatch[2]);
        const day = parseInt(fullMatch[3]);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return { year, month, day, type: 'standard' };
        }
    }
    
    const shortMatch = cleanStr.match(/^(\d{1,2})[\/\-](\d{1,2})(?:\s|$)/);
    if (shortMatch) {
        const month = parseInt(shortMatch[1]);
        const day = parseInt(shortMatch[2]);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return { month, day, type: 'standard' };
        }
    }
    
    // Định dạng Năm X Tháng M Ngày D (Bao gồm cả cách viết Ngày D Tháng M Năm X)
    // Cái này phải nằm trước Tháng X Ngày X thuần túy, nếu không sẽ mất năm
    const yearCnMatch = cleanStr.match(/Năm (\d+)\s*tháng (\d{1,2})\s*ngày (\d{1,2})?/i) || cleanStr.match(/Ngày (\d{1,2})\s*tháng (\d{1,2})\s*năm (\d+)/i) || cleanStr.match(/(\d+)\s*năm\s*(\d{1,2})\s*tháng\s*(\d{1,2})\s*ngày?/i);
    if (yearCnMatch) {
        let year, month, day;
        // Phân loại tùy theo cách khớp Ngày/Tháng/Năm
        if (yearCnMatch[0].toLowerCase().includes('ngày') && yearCnMatch[0].toLowerCase().indexOf('ngày') < yearCnMatch[0].toLowerCase().indexOf('năm')) {
            day = parseInt(yearCnMatch[1]);
            month = parseInt(yearCnMatch[2]);
            year = parseInt(yearCnMatch[3]);
        } else {
            year = parseInt(yearCnMatch[1]);
            month = parseInt(yearCnMatch[2]);
            day = parseInt(yearCnMatch[3]);
        }

        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            // Trích xuất tiền tố lịch pháp
            const fullMatchStr = yearCnMatch[0];
            const prefixEnd = cleanStr.indexOf(fullMatchStr);
            const calendarPrefix = cleanStr.substring(0, prefixEnd).trim() || undefined;
            return { year, month, day, type: 'standard', calendarPrefix };
        }
    }
    
    // Định dạng Tháng X Ngày X
    const cnMatch = cleanStr.match(/Tháng (\d{1,2})\s*ngày (\d{1,2})?/i) || cleanStr.match(/Ngày (\d{1,2})\s*tháng (\d{1,2})?/i) || cleanStr.match(/(\d{1,2})\s*tháng\s*(\d{1,2})\s*ngày?/i);
    if (cnMatch) {
        let month, day;
        if (cnMatch[0].toLowerCase().includes('ngày') && cnMatch[0].toLowerCase().indexOf('ngày') < cnMatch[0].toLowerCase().indexOf('tháng')) {
            day = parseInt(cnMatch[1]);
            month = parseInt(cnMatch[2]);
        } else {
            month = parseInt(cnMatch[1]);
            day = parseInt(cnMatch[2]);
        }

        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return { month, day, type: 'standard' };
        }
    }
    
    // Định dạng lịch giả tưởng
    const monthId = extractMonthIdentifier(cleanStr);
    const dayNum = extractDayNumber(cleanStr);
    
    if (monthId || dayNum !== null) {
        return { 
            monthId: monthId,
            day: dayNum,
            type: 'fantasy',
            raw: dateStr.trim(),
            aiWeekday: aiWeekdayMatch ? aiWeekdayMatch[1] : undefined
        };
    }
    
    return null;
}

/** Tính toán số ngày chênh lệch giữa hai ngày */
export function calculateRelativeTime(fromDate, toDate) {
    if (!fromDate || !toDate) return null;
    
    // Bỏ đi phần thời gian ở đuôi (như "15:00" / "Buổi chiều" / "Giờ Dậu"), giữ lại ngày tháng đầy đủ để so sánh
    const stripTime = (s) => s.trim()
        .replace(/\s+\d{1,2}[:：]\d{2}.*$/, '')
        .replace(/\s+(Rạng sáng|Buổi sáng|Sáng|Buổi trưa|Buổi chiều|Chạng vạng|Buổi tối|Đêm khuya|Giờ Tý|Giờ Sửu|Giờ Dần|Giờ Mão|Giờ Thìn|Giờ Tỵ|Giờ Ngọ|Giờ Mùi|Giờ Thân|Giờ Dậu|Giờ Tuất|Giờ Hợi).*$/i, '')
        .trim();
    const fromDateOnly = stripTime(fromDate);
    const toDateOnly = stripTime(toDate);
    
    if (fromDateOnly === toDateOnly) {
        return 0;
    }
    
    const from = parseStoryDate(fromDate);
    const to = parseStoryDate(toDate);
    
    if (!from || !to) return null;
    
    // Tính toán chính xác theo định dạng tiêu chuẩn
    if (from.type === 'standard' && to.type === 'standard') {
        const defaultYear = 2024;
        const fromYear = from.year || to.year || defaultYear;
        const toYear = to.year || from.year || defaultYear;
        
        const fromObj = new Date(0);
        fromObj.setFullYear(fromYear, from.month - 1, from.day);
        const toObj = new Date(0);
        toObj.setFullYear(toYear, to.month - 1, to.day);
        
        const diffTime = toObj.getTime() - fromObj.getTime();
        return Math.round(diffTime / (1000 * 60 * 60 * 24));
    }
    
    if (from.type === 'fantasy' || to.type === 'fantasy') {
        const fromDay = from.day;
        const toDay = to.day;
        const fromMonth = from.monthId || from.month;
        const toMonth = to.monthId || to.month;
        
        // Tính toán chính xác cùng tháng
        if (fromMonth && toMonth && fromMonth === toMonth && 
            fromDay !== null && toDay !== null) {
            return toDay - fromDay;
        }
        
        // Khác tháng: Logic cũ dùng độ lớn của "Ngày" để đoán trước sau, trên lịch giả tưởng/phương Tây rất dễ đoán sai
        if (fromDay !== null && toDay !== null) {
            if (fromMonth && toMonth && fromMonth !== toMonth) {
                return null;
            }
            return toDay - fromDay;
        }
        
        return -999;
    }
    
    return null;
}

/** Định dạng mô tả thời gian tương đối */
export function formatRelativeTime(days, options = {}) {
    if (days === null || days === undefined) return 'Không rõ';
    
    if (days === -999) return 'Khá sớm';
    if (days === -998) return 'Sau đó';
    if (days === -997) return 'Trước đó';
    
    // Vài ngày gần đây
    if (days === 0) return 'Hôm nay';
    if (days === 1) return 'Hôm qua';
    if (days === 2) return 'Hôm kia';
    if (days === 3) return 'Ba ngày trước';
    if (days === -1) return 'Ngày mai';
    if (days === -2) return 'Ngày kia';
    if (days === -3) return 'Ba ngày sau';
    
    const { fromDate, toDate } = options;
    
    if (days > 0) {
        if (days < 7) return `${days} ngày trước`;
        
        // Thứ mấy tuần trước
        if (days >= 4 && days <= 13 && fromDate) {
            const weekday = fromDate.getDay();
            return `${WEEKDAY_NAMES[weekday]} tuần trước`;
        }
        
        // Tháng trước
        if (days >= 20 && days < 60 && fromDate && toDate) {
            const fromMonth = fromDate.getMonth();
            const toMonth = toDate.getMonth();
            if (fromMonth !== toMonth) {
                return `Ngày ${fromDate.getDate()} tháng trước`;
            }
        }
        
        if (days >= 300 && fromDate && toDate) {
            const fromYear = fromDate.getFullYear();
            const toYear = toDate.getFullYear();
            if (fromYear < toYear) {
                const fromMonth = fromDate.getMonth() + 1;
                const fromDay = fromDate.getDate();
                if (days < 730) {
                    return `Ngày ${fromDay} tháng ${fromMonth} năm ngoái`;
                }
            }
        }
        
        if (days < 14) return `${Math.ceil(days / 7)} tuần trước`;
        if (days < 60) return `${Math.round(days / 30)} tháng trước`;
        if (days < 365) return `${Math.round(days / 30)} tháng trước`;
        const years = Math.floor(days / 365);
        const remainMonths = Math.round((days % 365) / 30);
        if (remainMonths > 0 && years < 5) return `${years} năm ${remainMonths} tháng trước`;
        return `${years} năm trước`;
    } else {
        const absDays = Math.abs(days);
        if (absDays < 7) return `${absDays} ngày sau`;
        
        if (absDays >= 4 && absDays <= 13 && fromDate) {
            const weekday = fromDate.getDay();
            return `${WEEKDAY_NAMES[weekday]} tuần sau`;
        }
        
        if (absDays >= 20 && absDays < 60 && fromDate && toDate) {
            const fromMonth = fromDate.getMonth();
            const toMonth = toDate.getMonth();
            if (fromMonth !== toMonth) {
                return `Ngày ${fromDate.getDate()} tháng sau`;
            }
        }
        
        if (absDays < 14) return `${Math.ceil(absDays / 7)} tuần sau`;
        if (absDays < 60) return `${Math.round(absDays / 30)} tháng sau`;
        if (absDays < 365) return `${Math.round(absDays / 30)} tháng sau`;
        const years = Math.floor(absDays / 365);
        const remainMonths = Math.round((absDays % 365) / 30);
        if (remainMonths > 0 && years < 5) return `${years} năm ${remainMonths} tháng sau`;
        return `${years} năm sau`;
    }
}

/** Định dạng ngày tháng cốt truyện thành định dạng tiêu chuẩn */
export function formatStoryDate(dateObj, includeWeekday = false) {
    if (!dateObj) return '';
    // Lịch giả tưởng giữ nguyên chuỗi ban đầu
    if (dateObj.raw && !dateObj.month) {
        let result = dateObj.raw;
        if (includeWeekday && dateObj.aiWeekday && !result.includes(`(${dateObj.aiWeekday})`)) {
            result += ` (${dateObj.aiWeekday})`;
        }
        return result;
    }
    
    let dateStr = '';
    const prefix = dateObj.calendarPrefix || '';
    
    if (dateObj.year) {
        if (prefix) {
            // Giữ nguyên tiền tố lịch pháp
            dateStr = `${prefix}Ngày ${dateObj.day} tháng ${dateObj.month} năm ${dateObj.year}`;
        } else {
            dateStr = `${dateObj.year}/${dateObj.month}/${dateObj.day}`;
        }
    } else if (dateObj.month && dateObj.day) {
        dateStr = `${dateObj.month}/${dateObj.day}`;
    }
    
    if (includeWeekday && dateObj.month && dateObj.day) {
        const refYear = dateObj.year || new Date().getFullYear();
        // setFullYear tránh sai lệch năm tự động
        const date = new Date(0);
        date.setFullYear(refYear, dateObj.month - 1, dateObj.day);
        const weekday = WEEKDAY_NAMES[date.getDay()];
        dateStr += ` (${weekday})`;
    }
    
    return dateStr;
}

/** Định dạng ngày giờ cốt truyện đầy đủ */
export function formatFullDateTime(dateStr, timeStr) {
    const parsed = parseStoryDate(dateStr);
    if (!parsed) return dateStr + (timeStr ? ' ' + timeStr : '');
    
    const dateWithWeekday = formatStoryDate(parsed, true);
    return dateWithWeekday + (timeStr ? ' ' + timeStr : '');
}

/** Lấy thời gian hệ thống hiện tại */
export function getCurrentSystemTime() {
    const now = new Date();
    return {
        date: `${now.getMonth() + 1}/${now.getDate()}`,
        time: `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`
    };
}

/** Tạo thông tin tham chiếu thời gian */
export function generateTimeReference(currentDate) {
    const current = parseStoryDate(currentDate);
    if (!current) return null;
    
    if (current.type === 'fantasy') {
        return {
            current: currentDate,
            type: 'fantasy',
            note: 'Chế độ lịch giả tưởng, ngày tháng tương đối do plugin tự động tính toán'
        };
    }
    
    const refYear = current.year || new Date().getFullYear();
    const baseDate = new Date(0);
    baseDate.setFullYear(refYear, current.month - 1, current.day);
    
    const getDateString = (daysOffset) => {
        const d = new Date(baseDate.getTime());
        d.setDate(d.getDate() + daysOffset);
        const weekday = WEEKDAY_NAMES[d.getDay()];
        return `${d.getMonth() + 1}/${d.getDate()} (${weekday})`;
    };
    
    return {
        current: currentDate,
        type: 'standard',
        yesterday: getDateString(-1),
        dayBefore: getDateString(-2),
        threeDaysAgo: getDateString(-3),
        tomorrow: getDateString(1)
    };
}

/** Tính toán chi tiết sự chênh lệch giữa hai ngày */
export function calculateDetailedRelativeTime(fromDateStr, toDateStr) {
    const days = calculateRelativeTime(fromDateStr, toDateStr);
    if (days === null) return { days: null, relative: 'Không rõ' };
    
    const from = parseStoryDate(fromDateStr);
    const to = parseStoryDate(toDateStr);
    
    let fromDate = null;
    let toDate = null;
    
    if (from?.type === 'standard' && to?.type === 'standard') {
        const defaultYear = new Date().getFullYear();
        const fromYear = from.year || to.year || defaultYear;
        const toYear = to.year || from.year || defaultYear;
        fromDate = new Date(0);
        fromDate.setFullYear(fromYear, from.month - 1, from.day);
        toDate = new Date(0);
        toDate.setFullYear(toYear, to.month - 1, to.day);
    }
    
    const relative = formatRelativeTime(days, { fromDate, toDate });
    
    return { days, fromDate, toDate, relative };
}

/** Trừ đi số ngày chỉ định từ ngày hiện tại */
export function subtractDays(dateStr, days) {
    const parsed = parseStoryDate(dateStr);
    if (!parsed || parsed.type === 'fantasy') return dateStr;
    
    const refYear = parsed.year || 2024;
    const date = new Date(0);
    date.setFullYear(refYear, parsed.month - 1, parsed.day);
    date.setDate(date.getDate() - days);
    
    if (parsed.year) {
        return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
    }
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** 12 Địa Chi → Giờ bắt đầu (Sơ = giờ đầu, Chính = giờ sau) */
const EARTHLY_BRANCH_HOURS = {
    'Tý': 23, 'Sửu': 1, 'Dần': 3, 'Mão': 5,
    'Thìn': 7, 'Tỵ': 9, 'Ngọ': 11, 'Mùi': 13,
    'Thân': 15, 'Dậu': 17, 'Tuất': 19, 'Hợi': 21
};

/** Lấy mô tả khoảng thời gian */
export function getTimeOfDay(timeStr) {
    if (!timeStr) return '';
    
    let hour = null;
    
    const match24 = timeStr.match(/(\d{1,2})[:：]/);
    if (match24) {
        hour = parseInt(match24[1]);
    }
    
    const matchCN = timeStr.match(/(Rạng sáng|Buổi sáng|Sáng|Buổi trưa|Buổi chiều|Chạng vạng|Buổi tối|Đêm khuya)/i);
    if (matchCN) {
        return matchCN[1];
    }
    
    // 12 Địa chi dự phòng (Tý Sửu Dần Mão Thìn Tỵ Ngọ Mùi Thân Dậu Tuất Hợi + tùy chọn "giờ"/"sơ"/"chính")
    if (hour === null) {
        const branchMatch = timeStr.match(/(Tý|Sửu|Dần|Mão|Thìn|Tỵ|Ngọ|Mùi|Thân|Dậu|Tuất|Hợi)\s*(?:giờ)?\s*(?:sơ|chính)?/i);
        if (branchMatch) {
            const base = EARTHLY_BRANCH_HOURS[branchMatch[1]];
            if (base !== undefined) {
                hour = /chính/i.test(branchMatch[0]) ? (base + 1) % 24 : base;
            }
        }
    }
    
    if (hour !== null) {
        if (hour >= 0 && hour < 5) return 'Rạng sáng';
        if (hour >= 5 && hour < 8) return 'Buổi sáng';
        if (hour >= 8 && hour < 11) return 'Sáng';
        if (hour >= 11 && hour < 13) return 'Buổi trưa';
        if (hour >= 13 && hour < 17) return 'Buổi chiều';
        if (hour >= 17 && hour < 19) return 'Chạng vạng';
        if (hour >= 19 && hour < 23) return 'Buổi tối';
        return 'Đêm khuya';
    }
    
    return '';
}
