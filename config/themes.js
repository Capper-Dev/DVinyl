const PRESETS = {
    default: { 
        label: 'Default (dark)',
        light: {
            bg: '#f8fafc',
            card: '#ffffff', 
            navbar: '#f1f5f9',
            text: '#0f172a',
            subtext: '#475569',
            highlight: '#10b981'
        },
        dark: {
            bg: '#171717',
            card: '#262626',
            navbar: '#0a0a0a',
            text: '#ffffff',
            subtext: '#ffffff',
            highlight: '#10b981'
        }
    },

    emerald: { 
        label: 'Emerald', 
        light: { 
            bg: '#f0fdf4',
            card: '#ffffff', 
            navbar: '#dcfce7',
            text: '#064e3b',
            subtext: '#166534',
            highlight: '#059669' 
        },
        dark: { 
            bg: '#022c22', 
            card: '#064e3b', 
            navbar: '#065f46', 
            text: '#ecfdf5', 
            subtext: '#ecfdf5', 
            highlight: '#34d399' 
        }
    },
    
    pink: { 
        label: 'Pink', 
        light: { 
            bg: '#fdf2f8',
            card: '#ffffff', 
            navbar: '#fce7f3',
            text: '#500724',
            subtext: '#9d174d',
            highlight: '#db2777' 
        },
        dark: { 
            bg: '#380620', 
            card: '#831843', 
            navbar: '#500724', 
            text: '#fdf2f8', 
            subtext: '#fdf2f8', 
            highlight: '#f472b6' 
        }
    },
    
    blue: { 
        label: 'Ocean', 
        light: { 
            bg: '#eff6ff',
            card: '#ffffff', 
            navbar: '#dbeafe',
            text: '#172554',
            subtext: '#1e40af',
            highlight: '#3b82f6' 
        },
        dark: { 
            bg: '#0f172a', 
            card: '#1e293b', 
            navbar: '#172554', 
            text: '#eff6ff', 
            subtext: '#eff6ff', 
            highlight: '#60a5fa' 
        }
    },
    
    amber: { 
        label: 'Amber', 
        light: { 
            bg: '#fffbeb',
            card: '#ffffff', 
            navbar: '#fef3c7',
            text: '#451a03',
            subtext: '#92400e',
            highlight: '#f59e0b' 
        },
        dark: { 
            bg: '#2e1003', 
            card: '#451a03', 
            navbar: '#78350f', 
            text: '#fffbeb', 
            subtext: '#fffbeb', 
            highlight: '#fbbf24' 
        }
    },
    
    purple: { 
        label: 'Purple', 
        light: { 
            bg: '#faf5ff',
            card: '#ffffff', 
            navbar: '#f3e8ff',
            text: '#2e1065',
            subtext: '#6b21a8',
            highlight: '#8b5cf6' 
        },
        dark: { 
            bg: '#2e1065', 
            card: '#4c1d95', 
            navbar: '#5b21b6', 
            text: '#f3e8ff', 
            subtext: '#f3e8ff', 
            highlight: '#a78bfa' 
        }
    }
};

module.exports = PRESETS;