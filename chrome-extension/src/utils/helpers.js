export function generateUserId() {
  return 'user_' + Math.random().toString(36).substr(2, 9);
}

export const rtcConfig = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302'] },
    { urls: ['stun:stun1.l.google.com:19302'] }
  ]
};
