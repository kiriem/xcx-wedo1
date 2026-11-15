// The block class learns the editor's locale from the VM. The GUI entry reads it here so its connection messages can
// be translated even before Xcratch hands the entry a formatter, which only happens when the extension library opens.
let currentLocale = null;

export const setCurrentLocale = locale => {
    currentLocale = locale;
};

export const getCurrentLocale = () => currentLocale;
