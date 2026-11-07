// 메일 제목과 본문. 문구나 디자인을 바꾸려면 이 파일만 고치면 된다.

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function layout(product, body) {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #eee;border-radius:12px">
      <div style="font-size:48px;text-align:center">${escapeHtml(product.emoji ?? '')}</div>
      ${body}
    </div>`;
}

// 알림 신청 직후 보내는 확인 메일 (신청 취소 링크 포함)
export function confirmMail({ product, sub, baseUrl }) {
  const name = escapeHtml(product.name);
  const cancelUrl = `${baseUrl}/api/unsubscribe/${sub.token}`;
  return {
    to: sub.email,
    subject: `[재입고 알림 신청 완료] ${product.name}`,
    text: `${product.name} 재입고 알림이 신청되었습니다. 입고되면 이 주소로 알려드릴게요.\n신청 취소: ${cancelUrl}`,
    html: layout(product, `
      <h2 style="text-align:center">재입고 알림 신청 완료</h2>
      <p style="text-align:center;color:#555">${name} 상품이 다시 입고되면<br>이 이메일로 바로 알려드릴게요.</p>
      <p style="font-size:12px;text-align:center"><a href="${cancelUrl}" style="color:#999">알림 신청 취소</a></p>`),
  };
}

// 재입고되었을 때 보내는 알림 메일
export function restockMail({ product, sub, baseUrl }) {
  const name = escapeHtml(product.name);
  const productUrl = `${baseUrl}/#${encodeURIComponent(product.id)}`;
  return {
    to: sub.email,
    subject: `[재입고 알림] ${product.name} 상품이 다시 입고되었어요!`,
    text: `${product.name} 상품이 재입고되었습니다. (남은 수량 ${product.stock}개)\n바로가기: ${productUrl}`,
    html: layout(product, `
      <h2 style="text-align:center">${name}<br>재입고되었습니다!</h2>
      <p style="text-align:center;color:#555">가격 ${Number(product.price).toLocaleString('ko-KR')}원 · 남은 수량 ${product.stock}개<br>수량이 한정되어 있으니 서둘러 주세요.</p>
      <p style="text-align:center"><a href="${productUrl}" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;border-radius:8px;text-decoration:none">지금 구매하기</a></p>
      <p style="font-size:12px;color:#999;text-align:center">재입고 알림을 신청하셔서 1회 발송된 메일입니다.</p>`),
  };
}
