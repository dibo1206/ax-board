// 메일 발송기.
// - .env 에 SMTP_HOST 가 있으면: 실제 SMTP(Gmail 등)로 발송
// - 없으면: Ethereal(테스트용 가짜 메일함)로 발송 → 실제로 배달되지 않고 미리보기 링크로 확인
import nodemailer from 'nodemailer';

async function createTransport(env) {
  if (env.SMTP_HOST) {
    const port = Number(env.SMTP_PORT || 587);
    return {
      mode: 'smtp',
      transporter: nodemailer.createTransport({
        host: env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      }),
    };
  }

  const account = await nodemailer.createTestAccount();
  return {
    mode: 'ethereal',
    transporter: nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: { user: account.user, pass: account.pass },
    }),
  };
}

export async function createMailer(env = process.env) {
  const { mode, transporter } = await createTransport(env);
  const from = env.MAIL_FROM || '"재입고 알림" <no-reply@restock.test>';

  return {
    mode,
    // 성공하면 { previewUrl } 반환 (Ethereal 일 때만 값이 있음), 실패하면 예외
    async send({ to, subject, html, text }) {
      const info = await transporter.sendMail({ from, to, subject, html, text });
      return { previewUrl: nodemailer.getTestMessageUrl(info) || null };
    },
  };
}
