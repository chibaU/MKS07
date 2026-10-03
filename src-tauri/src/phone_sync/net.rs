// اكتشاف عناوين الشبكة المحلية (IPv4 خاصة فقط) للكمبيوتر.
// لا اتصال بأي شبكة خارجية هنا — قراءة محوّلات النظام فقط.

use super::dto::AddressInfo;
use std::net::{IpAddr, Ipv4Addr};

/// نطاقات RFC 1918 فقط. عناوين link-local (169.254.x.x) تُستبعَد لأنها لا
/// تصلح عادةً لوصول هاتف عبر Wi-Fi منزلي/محلي.
pub fn is_private_lan(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    o[0] == 10 || (o[0] == 172 && (16..=31).contains(&o[1])) || (o[0] == 192 && o[1] == 168)
}

/// تخمين بالاسم: محوّلات افتراضية (Docker/WSL/VMware/VirtualBox/VPN...) أقل
/// ترجيحاً أن تكون شبكة الهاتف نفسها.
pub fn looks_virtual(name: &str) -> bool {
    let n = name.to_lowercase();
    [
        "docker", "veth", "vethernet", "wsl", "hyper-v", "vmware", "vmnet", "virtualbox",
        "vbox", "virbr", "br-", "tailscale", "zerotier", "tun", "tap", "vpn", "loopback",
        "npcap", "bluetooth",
    ]
    .iter()
    .any(|k| n.contains(k))
}

/// قائمة العناوين مرتبة بالأرجحية: غير الافتراضي أولاً ثم 192.168 ثم 10 ثم 172.
pub fn lan_addresses() -> Vec<AddressInfo> {
    let mut found: Vec<(Ipv4Addr, String, bool)> = Vec::new();
    if let Ok(ifaces) = if_addrs::get_if_addrs() {
        for iface in ifaces {
            if iface.is_loopback() {
                continue;
            }
            if let IpAddr::V4(v4) = iface.ip() {
                if !is_private_lan(v4) {
                    continue;
                }
                if found.iter().any(|(ip, _, _)| *ip == v4) {
                    continue;
                }
                let virt = looks_virtual(&iface.name);
                found.push((v4, iface.name.clone(), virt));
            }
        }
    }
    sort_addresses(&mut found);
    found
        .into_iter()
        .map(|(ip, interface, virt)| AddressInfo {
            ip: ip.to_string(),
            interface,
            likely: !virt,
        })
        .collect()
}

fn rank(ip: Ipv4Addr, virt: bool) -> u8 {
    let o = ip.octets();
    let base = if o[0] == 192 && o[1] == 168 {
        0
    } else if o[0] == 10 {
        1
    } else {
        2
    };
    base + if virt { 10 } else { 0 }
}

fn sort_addresses(v: &mut [(Ipv4Addr, String, bool)]) {
    v.sort_by_key(|(ip, _, virt)| (rank(*ip, *virt), *ip));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_ranges() {
        assert!(is_private_lan(Ipv4Addr::new(192, 168, 1, 7)));
        assert!(is_private_lan(Ipv4Addr::new(10, 0, 0, 2)));
        assert!(is_private_lan(Ipv4Addr::new(172, 16, 0, 1)));
        assert!(is_private_lan(Ipv4Addr::new(172, 31, 255, 1)));
        assert!(!is_private_lan(Ipv4Addr::new(172, 32, 0, 1)));
        assert!(!is_private_lan(Ipv4Addr::new(169, 254, 3, 4)));
        assert!(!is_private_lan(Ipv4Addr::new(8, 8, 8, 8)));
    }

    #[test]
    fn virtual_names_are_demoted() {
        assert!(looks_virtual("vEthernet (WSL)"));
        assert!(looks_virtual("docker0"));
        assert!(!looks_virtual("Wi-Fi"));
        assert!(!looks_virtual("Ethernet"));
        let mut v = vec![
            (Ipv4Addr::new(172, 17, 0, 1), "docker0".to_string(), true),
            (Ipv4Addr::new(10, 0, 0, 5), "Ethernet".to_string(), false),
            (Ipv4Addr::new(192, 168, 1, 9), "Wi-Fi".to_string(), false),
        ];
        sort_addresses(&mut v);
        assert_eq!(v[0].0, Ipv4Addr::new(192, 168, 1, 9));
        assert_eq!(v[1].0, Ipv4Addr::new(10, 0, 0, 5));
        assert_eq!(v[2].0, Ipv4Addr::new(172, 17, 0, 1));
    }
}
