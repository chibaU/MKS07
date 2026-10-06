// اكتشاف عناوين IPv4 المحلية الصالحة للشبكة المنزلية/المحل، وترتيبها بحيث يُعرَض
// أرجحها (واي فاي/إيثرنت حقيقي) أولاً، لا محوّلات الأجهزة الافتراضية (WSL, Docker,
// VirtualBox...) التي لا يصل إليها الهاتف أصلاً.

use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr};

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalIp {
    pub ip: Ipv4Addr,
    pub iface: String,
    pub score: i32,
}

const VIRTUAL_HINTS: [&str; 14] = [
    "vethernet", "virtual", "vmware", "vmnet", "vbox", "hyper-v", "docker", "wsl", "loopback",
    "bluetooth", "tailscale", "zerotier", "tap-", "veth",
];
const WIFI_HINTS: [&str; 4] = ["wi-fi", "wifi", "wlan", "wireless"];

pub fn score(ip: Ipv4Addr, iface: &str) -> i32 {
    let o = ip.octets();
    let mut s = if o[0] == 192 && o[1] == 168 {
        100
    } else if o[0] == 10 {
        80
    } else {
        60 // 172.16.0.0/12
    };
    let name = iface.to_lowercase();
    if VIRTUAL_HINTS.iter().any(|h| name.contains(h)) {
        s -= 70;
    } else if WIFI_HINTS.iter().any(|h| name.contains(h)) || name.contains("ethernet") || name.starts_with("en") || name.starts_with("wl") {
        s += 20;
    }
    s
}

pub fn list_local_ipv4() -> Vec<LocalIp> {
    let mut out: Vec<LocalIp> = Vec::new();
    let Ok(ifaces) = if_addrs::get_if_addrs() else {
        return out;
    };
    for iface in ifaces {
        if !iface.is_oper_up() {
            continue;
        }
        let IpAddr::V4(ip) = iface.ip() else { continue };
        if ip.is_loopback() || ip.is_link_local() || ip.is_unspecified() || !ip.is_private() {
            continue;
        }
        if out.iter().any(|x| x.ip == ip) {
            continue;
        }
        out.push(LocalIp { ip, iface: iface.name.clone(), score: score(ip, &iface.name) });
    }
    out.sort_by(|a, b| b.score.cmp(&a.score).then(a.ip.octets().cmp(&b.ip.octets())));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn real_wifi_beats_virtual_adapters() {
        let wifi = score(Ipv4Addr::new(192, 168, 1, 20), "Wi-Fi");
        let wsl = score(Ipv4Addr::new(172, 24, 0, 1), "vEthernet (WSL)");
        let vbox = score(Ipv4Addr::new(192, 168, 56, 1), "VirtualBox Host-Only Network");
        assert!(wifi > wsl);
        assert!(wifi > vbox);
    }

    #[test]
    fn private_ranges_ordered() {
        let a = score(Ipv4Addr::new(192, 168, 0, 5), "x");
        let b = score(Ipv4Addr::new(10, 0, 0, 5), "x");
        let c = score(Ipv4Addr::new(172, 16, 0, 5), "x");
        assert!(a > b && b > c);
    }
}
