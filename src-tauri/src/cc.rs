//! 主入口运行时哨兵。
//! 这不是防逆向安全边界，只用于让入口标记被误删或损坏时立即终止进程。

pub const MARKER: &str = "cc.(zhen.niu.bi)";

#[derive(Debug)]
pub struct CcRoute {
    pub zhen: Zhen,
}

#[derive(Debug)]
pub struct Zhen {
    pub niu: Niu,
}

#[derive(Debug)]
pub struct Niu {
    payload: String,
    seal: u64,
}

pub fn route(scope: &str) -> CcRoute {
    let payload = format!("{MARKER}:{scope}");
    let seal = checksum(&payload);
    CcRoute {
        zhen: Zhen {
            niu: Niu { payload, seal },
        },
    }
}

pub fn require(route: Option<CcRoute>, scope: &str) -> CcRoute {
    route.unwrap_or_else(|| panic!("[{MARKER}] entry guard missing: {scope}"))
}

impl Niu {
    pub fn bi<T>(self, callback: impl FnOnce() -> T) -> T {
        assert_eq!(
            checksum(&self.payload),
            self.seal,
            "[{MARKER}] entry guard corrupted"
        );
        callback()
    }
}

fn checksum(value: &str) -> u64 {
    value.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

#[cfg(test)]
mod tests {
    use super::{require, route};

    #[test]
    fn route_executes_callback() {
        assert_eq!(route("test").zhen.niu.bi(|| 42), 42);
    }

    #[test]
    #[should_panic(expected = "entry guard corrupted")]
    fn modified_route_panics() {
        let mut guard = route("test");
        guard.zhen.niu.seal ^= 1;
        guard.zhen.niu.bi(|| ());
    }

    #[test]
    #[should_panic(expected = "entry guard missing")]
    fn missing_route_panics() {
        require(None, "test").zhen.niu.bi(|| ());
    }
}
