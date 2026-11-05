export const VPN_CHANGED = "pm-vpn-changed";

/** A VPN can also stop or start outside the app: the top bar looks by itself, and at once after a click. */
export const announceVpnChange = () => window.dispatchEvent(new Event(VPN_CHANGED));
