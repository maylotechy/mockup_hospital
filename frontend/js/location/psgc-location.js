(function initializeIrdssPsgcLocation(window, $) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    IRDSS.location = IRDSS.location || {};
    let initialized = false;

    /**
     * PSGC API (https://psgc.cloud/api) Cascading Location Selector.
     * Shared cache + fetch logic, instantiated per set of region/province/city/barangay
     * selects (referral modal has geocoding, patient modal is just the four dropdowns).
     */
    let psgcCache = {
        regions: null,
        provinces: {},
        cities: {},
        barangays: {}
    };

    // psgc.cloud occasionally returns unrelated entries appended to a province/region's
    // city list (observed: Sarangani's cities-municipalities response also includes every
    // Metro Manila city/sub-municipality -- codes starting "13" (NCR) under a "12"
    // (SOCCSKSARGEN) province). Filter by the outer 2-digit REGION prefix only, not the
    // deeper province-level block: a Highly Urbanized City like City of Davao is coded
    // outside any province's own numbering block (1130700000 vs Davao del Sur's
    // 1102400000) even though it's correctly still part of that region and legitimately
    // belongs in the dropdown -- filtering on the full province prefix wrongly excluded it.
    function filterCitiesToExpectedArea(cities, regionCode) {
        const regionPrefix = regionCode ? regionCode.substring(0, 2) : null;
        if (!regionPrefix) return cities;
        const filtered = cities.filter(c => c.code && c.code.substring(0, 2) === regionPrefix);
        return filtered.length > 0 ? filtered : cities;
    }

    /**
     * @param {{region:string, province:string, city:string, barangay:string}} sel jQuery selectors
     * @param {function(string,string,string,string):void} [onResolved] called with (region, province, city, barangay) after every cascade step
     */
    function createLocationCascade(sel, onResolved) {
        let eventsBound = false;
        // When set (via init(preferredTarget)), each dropdown prefers selecting this exact
        // value over the hardcoded Davao-area defaults below -- used to prefill a patient's
        // own registered address instead of always defaulting to Davao City.
        let preferredTarget = null;
        const hasPreferred = function (fieldName) {
            return !!(preferredTarget && preferredTarget[fieldName]);
        };
        const prefers = function (fieldName, optionName) {
            return hasPreferred(fieldName) &&
                optionName.trim().toLowerCase() === preferredTarget[fieldName].trim().toLowerCase();
        };

        function resolve() {
            if (onResolved) {
                onResolved($(sel.region).val(), $(sel.province).val(), $(sel.city).val(), $(sel.barangay).val());
            }
        }

        function loadRegions() {
            const $regionSelect = $(sel.region);
            $regionSelect.empty().append('<option value="">Loading regions...</option>');

            if (psgcCache.regions && psgcCache.regions.length > 0) {
                populateRegionDropdown(psgcCache.regions);
                return;
            }

            $.ajax({
                url: 'https://psgc.cloud/api/regions',
                type: 'GET',
                dataType: 'json',
                xhrFields: { withCredentials: false },
                timeout: 5000,
                success: function(data) {
                    if (Array.isArray(data) && data.length > 0) {
                        psgcCache.regions = data;
                        populateRegionDropdown(data);
                    } else {
                        fallbackRegions();
                    }
                },
                error: function() {
                    fallbackRegions();
                }
            });
        }

        function populateRegionDropdown(regions) {
            const $regionSelect = $(sel.region);
            $regionSelect.empty();

            regions.forEach(region => {
                const option = $('<option>')
                    .attr('value', region.name)
                    .attr('data-code', region.code)
                    .text(region.name);

                // Prefer the patient's own registered region if we have one; otherwise
                // default to Region XI (Davao Region)
                if (hasPreferred('region') ? prefers('region', region.name) : (region.code === '1100000000' || region.name.includes('Davao'))) {
                    option.prop('selected', true);
                }

                $regionSelect.append(option);
            });

            if (!$regionSelect.val() && regions.length > 0) {
                $regionSelect.val(regions[0].name);
            }

            loadProvincesForSelectedRegion();
        }

        function fallbackRegions() {
            const $regionSelect = $(sel.region);
            $regionSelect.empty().append(`
                <option value="Region XI (Davao Region)" data-code="1100000000" selected>Region XI (Davao Region)</option>
                <option value="Region X (Northern Mindanao)" data-code="1000000000">Region X (Northern Mindanao)</option>
                <option value="Region IX (Zamboanga Peninsula)" data-code="0900000000">Region IX (Zamboanga Peninsula)</option>
                <option value="Region XII (SOCCSKSARGEN)" data-code="1200000000">Region XII (SOCCSKSARGEN)</option>
                <option value="Region XIII (Caraga)" data-code="1600000000">Region XIII (Caraga)</option>
                <option value="BARMM" data-code="1900000000">BARMM</option>
                <option value="NCR (Metro Manila)" data-code="1300000000">NCR (Metro Manila)</option>
            `);
            loadProvincesForSelectedRegion();
        }

        function loadProvincesForSelectedRegion() {
            const regionCode = $(sel.region).find('option:selected').attr('data-code');
            const $provinceSelect = $(sel.province);
            $provinceSelect.empty().append('<option value="">Loading provinces...</option>');

            if (!regionCode) {
                loadCitiesForSelectedProvince();
                return;
            }

            if (psgcCache.provinces[regionCode]) {
                populateProvinceDropdown(psgcCache.provinces[regionCode]);
                return;
            }

            $.ajax({
                url: `https://psgc.cloud/api/regions/${regionCode}/provinces`,
                type: 'GET',
                dataType: 'json',
                xhrFields: { withCredentials: false },
                timeout: 5000,
                success: function(data) {
                    if (Array.isArray(data)) {
                        psgcCache.provinces[regionCode] = data;
                        populateProvinceDropdown(data);
                    } else {
                        fallbackProvinces();
                    }
                },
                error: function() {
                    fallbackProvinces();
                }
            });
        }

        function populateProvinceDropdown(provinces) {
            const $provinceSelect = $(sel.province);
            $provinceSelect.empty();

            if (provinces.length === 0) {
                const regionName = $(sel.region).val();
                $provinceSelect.append(`<option value="${regionName}" data-code="N/A">${regionName}</option>`);
            } else {
                provinces.forEach(prov => {
                    const option = $('<option>')
                        .attr('value', prov.name)
                        .attr('data-code', prov.code)
                        .text(prov.name);

                    if (hasPreferred('province') ? prefers('province', prov.name) : prov.name.includes('Davao del Sur')) {
                        option.prop('selected', true);
                    }
                    $provinceSelect.append(option);
                });

                if (!$provinceSelect.val() && provinces.length > 0) {
                    $provinceSelect.val(provinces[0].name);
                }
            }

            loadCitiesForSelectedProvince();
        }

        function fallbackProvinces() {
            const $provinceSelect = $(sel.province);
            $provinceSelect.empty().append(`
                <option value="Davao del Sur" data-code="1102400000" selected>Davao del Sur</option>
                <option value="Davao del Norte" data-code="1102300000">Davao del Norte</option>
                <option value="Misamis Oriental" data-code="1004300000">Misamis Oriental</option>
                <option value="South Cotabato" data-code="1206300000">South Cotabato</option>
            `);
            loadCitiesForSelectedProvince();
        }

        function loadCitiesForSelectedProvince() {
            const provinceCode = $(sel.province).find('option:selected').attr('data-code');
            const regionCode = $(sel.region).find('option:selected').attr('data-code');
            const $citySelect = $(sel.city);
            $citySelect.empty().append('<option value="">Loading cities...</option>');

            const fetchUrl = (provinceCode && provinceCode !== 'N/A')
                ? `https://psgc.cloud/api/provinces/${provinceCode}/cities-municipalities`
                : `https://psgc.cloud/api/regions/${regionCode}/cities-municipalities`;

            const cacheKey = (provinceCode && provinceCode !== 'N/A') ? provinceCode : `region_${regionCode}`;

            if (psgcCache.cities[cacheKey]) {
                populateCityDropdown(psgcCache.cities[cacheKey]);
                return;
            }

            $.ajax({
                url: fetchUrl,
                type: 'GET',
                dataType: 'json',
                xhrFields: { withCredentials: false },
                timeout: 5000,
                success: function(data) {
                    if (Array.isArray(data)) {
                        const cleanData = filterCitiesToExpectedArea(data, regionCode);
                        psgcCache.cities[cacheKey] = cleanData;
                        populateCityDropdown(cleanData);
                    } else {
                        fallbackCities();
                    }
                },
                error: function() {
                    fallbackCities();
                }
            });
        }

        function populateCityDropdown(cities) {
            const $citySelect = $(sel.city);
            $citySelect.empty();

            cities.forEach(city => {
                const option = $('<option>')
                    .attr('value', city.name)
                    .attr('data-code', city.code)
                    .text(city.name);

                if (hasPreferred('city') ? prefers('city', city.name) : city.name.includes('Davao')) {
                    option.prop('selected', true);
                }
                $citySelect.append(option);
            });

            if (!$citySelect.val() && cities.length > 0) {
                $citySelect.val(cities[0].name);
            }

            loadBarangaysForSelectedCity();
        }

        function fallbackCities() {
            const $citySelect = $(sel.city);
            $citySelect.empty().append(`
                <option value="City of Davao" data-code="1130700000" selected>City of Davao</option>
                <option value="City of Digos" data-code="1102403000">City of Digos</option>
                <option value="Santa Cruz" data-code="1102412000">Santa Cruz</option>
            `);
            loadBarangaysForSelectedCity();
        }

        function loadBarangaysForSelectedCity() {
            const cityCode = $(sel.city).find('option:selected').attr('data-code');
            const $barangaySelect = $(sel.barangay);
            $barangaySelect.empty().append('<option value="">Loading barangays...</option>');

            if (!cityCode) {
                resolve();
                return;
            }

            if (psgcCache.barangays[cityCode]) {
                populateBarangayDropdown(psgcCache.barangays[cityCode]);
                return;
            }

            $.ajax({
                url: `https://psgc.cloud/api/cities-municipalities/${cityCode}/barangays`,
                type: 'GET',
                dataType: 'json',
                xhrFields: { withCredentials: false },
                timeout: 5000,
                success: function(data) {
                    if (Array.isArray(data)) {
                        psgcCache.barangays[cityCode] = data;
                        populateBarangayDropdown(data);
                    } else {
                        fallbackBarangays();
                    }
                },
                error: function() {
                    fallbackBarangays();
                }
            });
        }

        function populateBarangayDropdown(barangays) {
            const $barangaySelect = $(sel.barangay);
            $barangaySelect.empty();

            if (barangays.length === 0) {
                $barangaySelect.append('<option value="Poblacion" data-code="N/A">Poblacion</option>');
            } else {
                barangays.forEach(brgy => {
                    const option = $('<option>')
                        .attr('value', brgy.name)
                        .attr('data-code', brgy.code)
                        .text(brgy.name);

                    if (hasPreferred('barangay') ? prefers('barangay', brgy.name) : (brgy.name.toLowerCase().includes('buhangin') || brgy.name.toLowerCase().includes('poblacion'))) {
                        option.prop('selected', true);
                    }
                    $barangaySelect.append(option);
                });

                if (!$barangaySelect.val() && barangays.length > 0) {
                    $barangaySelect.val(barangays[0].name);
                }
            }

            resolve();
        }

        function fallbackBarangays() {
            const $barangaySelect = $(sel.barangay);
            $barangaySelect.empty().append(`
                <option value="Buhangin" data-code="1130700100" selected>Buhangin</option>
                <option value="Poblacion" data-code="1130700200">Poblacion</option>
                <option value="Agdao" data-code="1130700300">Agdao</option>
            `);
            resolve();
        }

        return {
            /**
             * @param {{region:string, province:string, city:string, barangay:string}} [target]
             *   When given, each dropdown selects this exact address instead of the
             *   hardcoded Davao-area defaults -- e.g. a patient's own registered address.
             */
            init: function(target) {
                preferredTarget = target || null;
                if (!eventsBound) {
                    eventsBound = true;
                    $(sel.region).on('change', loadProvincesForSelectedRegion);
                    $(sel.province).on('change', loadCitiesForSelectedProvince);
                    $(sel.city).on('change', loadBarangaysForSelectedCity);
                    $(sel.barangay).on('change', resolve);
                }
                loadRegions();
            }
        };
    }

    let geocodeDebounceTimer = null;

    function applyCoordinates(lat, lng) {
        const latFormatted = parseFloat(lat).toFixed(6);
        const lngFormatted = parseFloat(lng).toFixed(6);

        $('#modalLatitude').val(latFormatted);
        $('#modalLongitude').val(lngFormatted);
        $('#displayLatLongText').text(`${latFormatted}, ${lngFormatted}`);
    }

    const referralLocationCascade = createLocationCascade({
        region: '#selectRegion', province: '#selectProvince', city: '#selectCity', barangay: '#selectBarangay'
    }, function(region, province, city, barangay) {
        const resolvedAddress = [barangay, city, province, region].filter(Boolean).join(', ');
        $('#displayResolvedAddress').text(resolvedAddress);

        let defaultLat = 7.1907;
        let defaultLng = 125.4553;

        if (city) {
            const cLower = city.toLowerCase();
            if (cLower.includes('cagayan de oro')) { defaultLat = 8.4542; defaultLng = 124.6319; }
            else if (cLower.includes('general santos')) { defaultLat = 6.1164; defaultLng = 125.1716; }
            else if (cLower.includes('zamboanga')) { defaultLat = 6.9214; defaultLng = 122.0790; }
            else if (cLower.includes('butuan')) { defaultLat = 8.9475; defaultLng = 125.5406; }
            else if (cLower.includes('digos')) { defaultLat = 6.7583; defaultLng = 125.3572; }
            else if (cLower.includes('cebu')) { defaultLat = 10.3157; defaultLng = 123.8854; }
            else if (cLower.includes('manila') || cLower.includes('quezon')) { defaultLat = 14.5995; defaultLng = 120.9842; }
        }

        applyCoordinates(defaultLat, defaultLng);

        if (geocodeDebounceTimer) clearTimeout(geocodeDebounceTimer);

        geocodeDebounceTimer = setTimeout(() => {
            const query = `${barangay ? barangay + ', ' : ''}${city}, ${province}, Philippines`;

            $.ajax({
                url: 'https://nominatim.openstreetmap.org/search',
                data: { format: 'json', q: query, limit: 1 },
                dataType: 'json',
                xhrFields: { withCredentials: false },
                timeout: 4000,
                success: function(results) {
                    if (results && results.length > 0) {
                        const lat = parseFloat(results[0].lat);
                        const lng = parseFloat(results[0].lon);
                        applyCoordinates(lat, lng);
                    }
                }
            });
        }, 400);
    });

    const patientLocationCascade = createLocationCascade({
        region: '#patRegion', province: '#patProvince', city: '#patCity', barangay: '#patBarangay'
    });

    function init() {
        if (initialized) return;
        initialized = true;
    }

    IRDSS.location.psgc = Object.freeze({
        init,
        createCascade: createLocationCascade,
        initializeReferral: function (location) { referralLocationCascade.init(location); },
        initializePatient: function (location) { patientLocationCascade.init(location); },
        applyCoordinates
    });
})(window, window.jQuery);
