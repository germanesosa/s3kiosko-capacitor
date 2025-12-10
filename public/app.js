// S3 Viewer - Visualizador de archivos Rhino 3DM
// Germán E. Sosa

// ============================================
// SISTEMA DE LOGGING PARA MÓVILES (debe ir primero)
// ============================================
const mobileConsole = {
    logs: [],
    maxLogs: 500,

    addLog(type, args) {
        const timestamp = new Date().toLocaleTimeString();
        const message = Array.from(args).map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 2);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');

        this.logs.push({ timestamp, type, message });
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }

        this.updateViewer();
    },

    updateViewer() {
        const content = document.getElementById('consoleContent');
        if (content) {
            const html = this.logs.map(log => {
                const color = {
                    'log': '#0f0',
                    'warn': '#ff0',
                    'error': '#f00',
                    'info': '#0ff'
                }[log.type] || '#0f0';

                return `<div style="color:${color}; margin-bottom:5px;">
                    <span style="color:#888;">[${log.timestamp}]</span> ${log.message}
                </div>`;
            }).join('');
            content.innerHTML = html;
            content.scrollTop = content.scrollHeight;
        }
    }
};

// Interceptar console.log, console.error, console.warn INMEDIATAMENTE
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const originalInfo = console.info;

console.log = function(...args) {
    originalLog.apply(console, args);
    mobileConsole.addLog('log', args);
};

console.error = function(...args) {
    originalError.apply(console, args);
    mobileConsole.addLog('error', args);
};

console.warn = function(...args) {
    originalWarn.apply(console, args);
    mobileConsole.addLog('warn', args);
};

console.info = function(...args) {
    originalInfo.apply(console, args);
    mobileConsole.addLog('info', args);
};

console.log('🎬 Sistema de logging móvil activado');

// ============================================
// CLASE PRINCIPAL
// ============================================
class S3Viewer {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.rhino = null;
        this.doc = null;
        this.layers = new Map();
        this.objects = new Map();
        this.dots = [];
        this.surfaceLabels = []; // Array de labels con sus meshes asociados
        this.wireframeMode = false;
        this.edgeWidth = 0.005; // Grosor de bordes fijo
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.clickTimeout = null;
        this.dynamicSprites = []; // Sprites que se actualizan con el zoom

        // Detectar dispositivo móvil/Android para compatibilidad WebGL
        this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        this.isAndroid = /Android/i.test(navigator.userAgent);

        console.log('🔍 User Agent:', navigator.userAgent);
        console.log('📱 isMobile:', this.isMobile);
        console.log('🤖 isAndroid:', this.isAndroid);

        // Configuración de filtros de capas (como gsCuales)
        this.layerFilters = {
            'GS': { enabled: true, type: 'surfaces' },    // Mostrar solo superficies NURBS
            'S3': { enabled: true, type: 'surfaces' },    // Mostrar solo superficies NURBS
            'DECO': { enabled: false, type: 'curves' },   // Mostrar curvas/líneas
            'TS': { enabled: false, type: 'curves' },     // Mostrar curvas/líneas
            'BND': { enabled: false, type: 'all' },       // Bordes y costuras
            'OUT': { enabled: false, type: 'all' },       // Patrones exportados
            'AUX': { enabled: false, type: 'all' }        // Auxiliares
        };

        this.init();
    }

    async init() {
        try {
            console.log('🔄 Iniciando S3Viewer...');
            this.isReady = false;  // Flag para saber si está listo

            // Detectar si estamos en Android WebView
            const isAndroidWebView = window.Android !== undefined;
            console.log('🤖 Android WebView:', isAndroidWebView);

            // Test de conectividad con el servidor (solo si NO estamos en Android)
            if (!isAndroidWebView) {
                console.log('🔄 Probando conectividad con el servidor...');
                try {
                    const healthResponse = await fetch('/api/health');
                    const healthData = await healthResponse.json();
                    console.log('✅ Servidor respondiendo:', healthData);
                } catch (healthError) {
                    console.error('❌ Error de conectividad con el servidor:', healthError);
                    // No bloquear en modo local/Android
                    console.log('⚠️ Continuando sin servidor...');
                }
            }

            // Inicializar rhino3dm
            console.log('🔄 Cargando rhino3dm...');
            this.rhino = await rhino3dm();
            console.log('✅ rhino3dm cargado');

            // Inicializar Three.js
            console.log('🔄 Inicializando Three.js...');
            this.initThree();
            console.log('✅ Three.js inicializado');

            console.log('🔄 Configurando event listeners...');
            this.setupEventListeners();
            console.log('✅ Event listeners configurados');

            // Cargar lista de archivos disponibles (solo si no estamos en Android)
            if (!isAndroidWebView) {
                console.log('🔄 Cargando lista de archivos...');
                await this.loadAvailableFiles();
                console.log('✅ Lista de archivos cargada');
            } else {
                console.log('📱 Modo Android: archivos se cargan desde la app');
            }

            console.log('🔄 Iniciando loop de animación...');
            this.animate();

            // Marcar como listo
            this.isReady = true;
            console.log('✅ S3Viewer inicializado correctamente - isReady:', this.isReady);
        } catch (error) {
            console.error('❌ Error crítico en init():', error);
            console.error('❌ Stack:', error.stack);
            // No mostrar alert en Android, solo log
            if (!window.Android) {
                alert('Error al inicializar la aplicación: ' + error.message + '\n\nAbre el visor de consola (botón azul 📋) para más detalles.');
            }
            throw error;
        }
    }

    initThree() {
        try {
            console.log('🔄 [initThree] Buscando contenedor viewer...');
            const container = document.getElementById('viewer');

            if (!container) {
                throw new Error('No se encontró el elemento #viewer en el DOM');
            }

            console.log('🔄 [initThree] Contenedor encontrado, dimensiones:', container.clientWidth, 'x', container.clientHeight);

            if (container.clientWidth === 0 || container.clientHeight === 0) {
                console.warn('⚠️ Contenedor con dimensiones 0, usando valores por defecto');
            }

            // Verificar que THREE esté disponible
            if (typeof THREE === 'undefined') {
                throw new Error('THREE.js no está cargado');
            }
            console.log('✅ THREE.js disponible');

            // Scene
            console.log('🔄 [initThree] Creando escena...');
            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color(0x808080);
            console.log('✅ Escena creada');

            // Camera
            console.log('🔄 [initThree] Creando cámara...');
            const aspect = container.clientWidth / container.clientHeight || 1;
            this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 10000);
            this.camera.position.set(10, 10, 10);
            console.log('✅ Cámara creada');

            // Renderer
            console.log('🔄 [initThree] Creando renderer...');

            if (this.isMobile) {
                console.log('📱 Dispositivo móvil detectado');
            }
            if (this.isAndroid) {
                console.log('🤖 Android detectado - curvas se renderizarán como tubos para compatibilidad');
            }

            // Renderer para GPUs modernos (Adreno 830, etc.)
            try {
                this.renderer = new THREE.WebGLRenderer({
                    antialias: true,
                    powerPreference: 'high-performance',
                    precision: 'highp'
                });
                console.log('✅ WebGLRenderer creado');
            } catch (e) {
                console.error('❌ Error creando WebGLRenderer:', e);
                throw e;
            }

            this.renderer.setSize(container.clientWidth || 800, container.clientHeight || 600);
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isMobile ? 1.5 : 2));
            container.appendChild(this.renderer.domElement);

            // Log de información del renderer
            const glInfo = this.renderer.getContext();
            console.log('📊 WebGL Version:', glInfo.getParameter(glInfo.VERSION));
            console.log('📊 GLSL Version:', glInfo.getParameter(glInfo.SHADING_LANGUAGE_VERSION));
            console.log('📊 Renderer:', glInfo.getParameter(glInfo.RENDERER));
            console.log('✅ Renderer creado y agregado al DOM');

            // Controls
            console.log('🔄 [initThree] Creando controles...');
            if (typeof THREE.OrbitControls === 'undefined') {
                throw new Error('OrbitControls no está cargado');
            }
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.05;
            console.log('✅ Controles creados');

            // Lights
            console.log('🔄 [initThree] Agregando luces...');
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
            this.scene.add(ambientLight);

            const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
            directionalLight.position.set(10, 10, 10);
            this.scene.add(directionalLight);
            console.log('✅ Luces agregadas');

            // Grid
            console.log('🔄 [initThree] Agregando grid...');
            const gridHelper = new THREE.GridHelper(100, 100, 0x888888, 0x8a8a8a);
            this.scene.add(gridHelper);
            console.log('✅ Grid agregado');

            // Axes
            console.log('🔄 [initThree] Agregando ejes...');
            const axesHelper = new THREE.AxesHelper(5);
            this.scene.add(axesHelper);
            console.log('✅ Ejes agregados');

            // Resize handler
            console.log('🔄 [initThree] Configurando resize handler...');
            window.addEventListener('resize', () => this.onWindowResize());
            console.log('✅ Resize handler configurado');

        } catch (error) {
            console.error('❌ Error en initThree:', error);
            console.error('❌ Stack:', error.stack);
            throw error;
        }
    }

    setupEventListeners() {
        // Upload button
        document.getElementById('uploadBtn').addEventListener('click', () => {
            const fileInput = document.getElementById('fileInput');
            if (fileInput.files.length > 0) {
                this.loadFile(fileInput.files[0]);
            }
        });

        // File input change
        document.getElementById('fileInput').addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.loadFile(e.target.files[0]);
            }
        });

        // Layer search
        document.getElementById('layerSearch').addEventListener('input', (e) => {
            this.filterLayers(e.target.value);
        });

        // Dots toggle
        document.getElementById('showDots').addEventListener('change', (e) => {
            this.toggleDots(e.target.checked);
        });

        // Double click/tap en viewer para mostrar info de superficie
        const viewer = document.getElementById('viewer');
        viewer.addEventListener('dblclick', (e) => this.onDoubleClick(e));

        // Soporte para doble tap en dispositivos táctiles
        let lastTap = 0;
        viewer.addEventListener('touchend', (e) => {
            const currentTime = new Date().getTime();
            const tapLength = currentTime - lastTap;
            if (tapLength < 500 && tapLength > 0) {
                // Doble tap detectado
                e.preventDefault();
                this.onDoubleClick(e.changedTouches[0]);
            }
            lastTap = currentTime;
        });

        // View controls
        document.getElementById('resetView').addEventListener('click', () => this.resetView());
        document.getElementById('topView').addEventListener('click', () => this.setTopView());
        document.getElementById('frontView').addEventListener('click', () => this.setFrontView());
        document.getElementById('wireframeToggle').addEventListener('click', () => this.toggleWireframe());

        // Layer filters
        document.getElementById('applyFilters').addEventListener('click', () => this.applyLayerFilters());
    }

    applyLayerFilters() {
        // Actualizar configuración de filtros
        this.layerFilters.GS = document.getElementById('filterGS').checked;
        this.layerFilters.S3 = document.getElementById('filterS3').checked;
        this.layerFilters.BND = document.getElementById('filterBND').checked;
        this.layerFilters.OUT = document.getElementById('filterOUT').checked;
        this.layerFilters.TS = document.getElementById('filterTS').checked;
        this.layerFilters.DECO = document.getElementById('filterDECO').checked;
        this.layerFilters.AUX = document.getElementById('filterAUX').checked;

        // Recargar archivo con nuevos filtros
        if (this.doc) {
            this.clearScene();
            this.processLayers();
            this.processObjectsWithMeshes();
            this.processDots();
            this.updateLayerList();
            this.updateDotsList();
            this.fitCameraToScene();
        }
    }

    async loadFile(file) {
        const loadingOverlay = document.getElementById('loadingOverlay');
        loadingOverlay.classList.add('active');

        try {
            console.log('📂 Iniciando carga de archivo:', file.name);
            console.log('📦 Tamaño del archivo:', file.size, 'bytes');
            console.log('📦 Tamaño en MB:', (file.size / (1024 * 1024)).toFixed(2), 'MB');

            // Verificar tamaño máximo (50MB)
            const MAX_FILE_SIZE = 50 * 1024 * 1024;
            if (file.size > MAX_FILE_SIZE) {
                throw new Error(`Archivo demasiado grande. Máximo: 50MB, Archivo: ${(file.size / (1024 * 1024)).toFixed(2)}MB`);
            }

            // Liberar documento anterior si existe
            if (this.doc) {
                console.log('🧹 Liberando documento anterior...');
                try { this.doc.delete(); } catch (e) { console.warn('No se pudo eliminar doc anterior'); }
                this.doc = null;
            }

            console.log('🔄 Leyendo arrayBuffer...');
            const arrayBuffer = await file.arrayBuffer();
            console.log('✅ ArrayBuffer leído, tamaño:', arrayBuffer.byteLength);

            console.log('🔄 Creando Uint8Array...');
            const arr = new Uint8Array(arrayBuffer);
            console.log('✅ Uint8Array creado, length:', arr.length);

            // Leer archivo 3dm con timeout
            console.log('🔄 Parseando archivo 3dm con rhino3dm...');

            // Usar setTimeout para dar tiempo al UI de actualizar
            await new Promise(resolve => setTimeout(resolve, 100));

            this.doc = this.rhino.File3dm.fromByteArray(arr);
            console.log('✅ Archivo 3dm parseado correctamente');

            console.log('📄 Archivo cargado:', file.name);
            console.log('📊 Objetos:', this.getCount(this.doc.objects()));
            console.log('📋 Capas:', this.getCount(this.doc.layers()));

            // Limpiar escena
            console.log('🧹 Limpiando escena...');
            this.clearScene();
            console.log('✅ Escena limpiada');

            // Procesar archivo
            console.log('🔄 Procesando capas...');
            this.processLayers();
            console.log('✅ Capas procesadas:', this.layers.size);

            console.log('🔄 Procesando objetos con meshes...');
            this.processObjectsWithMeshes();
            console.log('✅ Objetos procesados');

            console.log('🔄 Procesando dots...');
            this.processDots();
            console.log('✅ Dots procesados:', this.dots.length);

            // Actualizar UI
            console.log('🔄 Actualizando UI...');
            this.updateFileInfo(file);
            this.updateLayerList();
            this.updateDotsList();
            console.log('✅ UI actualizada');

            // Ajustar cámara
            console.log('📐 Ajustando cámara...');
            this.fitCameraToScene();
            console.log('✅ Cámara ajustada');

            console.log('🎉 Carga completada exitosamente');

        } catch (error) {
            console.error('❌ Error al cargar archivo:', error);
            console.error('❌ Error name:', error.name);
            console.error('❌ Error message:', error.message);
            console.error('❌ Stack trace:', error.stack);

            // Mostrar error en pantalla para debugging en móviles
            const errorDiv = document.createElement('div');
            errorDiv.style.cssText = 'position:fixed;top:50px;left:10px;right:10px;background:red;color:white;padding:15px;z-index:9999;font-size:11px;max-height:300px;overflow:auto;';
            errorDiv.innerHTML = `
                <strong>Error al cargar archivo:</strong><br>
                ${error.name}: ${error.message}<br><br>
                <strong>Stack:</strong><br>
                ${error.stack ? error.stack.replace(/\n/g, '<br>') : 'No disponible'}
            `;
            document.body.appendChild(errorDiv);

            alert('Error al cargar el archivo: ' + error.message + '\n\nRevisa el cuadro rojo para más detalles.');
        } finally {
            loadingOverlay.classList.remove('active');
        }
    }

    // Helper para obtener el count de colecciones de rhino3dm
    getCount(collection) {
        // En rhino3dm 8.x, count es una propiedad, no una función
        if (typeof collection.count === 'number') {
            return collection.count;
        }
        if (typeof collection.count === 'function') {
            return collection.count();
        }
        return collection.length || 0;
    }

    // Helper para obtener un elemento de una colección de rhino3dm
    getItem(collection, index) {
        // En rhino3dm 8.x, get es un método
        if (typeof collection.get === 'function') {
            return collection.get(index);
        }
        return collection[index];
    }

    clearScene() {
        // Remover objetos anteriores
        while(this.scene.children.length > 0) {
            this.scene.remove(this.scene.children[0]);
        }

        // Re-agregar luces y helpers
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 10, 10);
        this.scene.add(directionalLight);

        // Grid
        const gridHelper = new THREE.GridHelper(100, 100, 0x888888, 0x8a8a8a);
        this.scene.add(gridHelper);

        const axesHelper = new THREE.AxesHelper(5);
        this.scene.add(axesHelper);

        this.layers.clear();
        this.objects.clear();
        this.dots = [];
        this.surfaceLabels = [];
    }

    processLayers() {
        const layers = this.doc.layers();
        const layerCount = this.getCount(layers);

        console.log('🔍 Procesando', layerCount, 'capas...');

        for (let i = 0; i < layerCount; i++) {
            const layer = this.getItem(layers, i);

            // Filtrar capas según configuración (como gsCuales)
            // Usar fullPath en lugar de name para capturar la jerarquía
            const shouldShow = this.shouldShowLayer(layer.fullPath);

            if (shouldShow) {
                const layerData = {
                    name: layer.name,
                    fullPath: layer.fullPath,
                    color: layer.color,
                    visible: layer.visible,
                    index: layer.index,
                    id: layer.id,
                    objects: []
                };
                // Usar el ID de la capa como key en lugar del index
                this.layers.set(layer.id, layerData);
                console.log('  ✅ Capa aceptada:', layer.fullPath);
            }
        }

        console.log('📋 Total capas filtradas:', this.layers.size);
    }

    shouldShowLayer(layerFullPath) {
        // SOLO mostrar capas GS:: y S3:: (no OUT, BND, AUX, etc.)
        // Verificar si es una capa hija de GS o S3
        if (layerFullPath.startsWith('GS::') || layerFullPath.startsWith('S3::')) {
            return true;
        }
        // También mostrar las capas padre GS y S3 si tienen objetos directos
        if (layerFullPath === 'GS' || layerFullPath === 'S3') {
            return true;
        }

        return false;
    }

    addBrepBoundaries(brep, mesh, layer) {
        try {
            if (!mesh || !mesh.geometry) {
                console.warn('⚠️ Mesh inválido para agregar bordes');
                return;
            }

            // Usar EdgesGeometry con threshold de 30 grados
            // Esto captura bordes donde el ángulo entre caras es > 30 grados
            const edges = new THREE.EdgesGeometry(mesh.geometry, 30);

            if (!edges.attributes || !edges.attributes.position) {
                console.warn('⚠️ EdgesGeometry sin atributos de posición');
                edges.dispose();
                return;
            }

            const positions = edges.attributes.position.array;
            let edgesAdded = 0;

            // Crear cilindros gruesos para cada segmento de borde
            for (let i = 0; i < positions.length; i += 6) {
                const start = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]);
                const end = new THREE.Vector3(positions[i + 3], positions[i + 4], positions[i + 5]);

                const direction = new THREE.Vector3().subVectors(end, start);
                const length = direction.length();

                if (length < 0.001) continue; // Ignorar segmentos muy pequeños

                // Crear cilindro negro con grosor ajustable
                const cylinder = new THREE.CylinderGeometry(this.edgeWidth, this.edgeWidth, length, 8);
                const material = new THREE.MeshBasicMaterial({ color: 0x000000 });
                const cylinderMesh = new THREE.Mesh(cylinder, material);
                cylinderMesh.userData.isEdge = true; // Marcar como borde para poder actualizarlo

                // Posicionar y orientar el cilindro
                cylinderMesh.position.copy(start).add(direction.multiplyScalar(0.5));
                cylinderMesh.quaternion.setFromUnitVectors(
                    new THREE.Vector3(0, 1, 0),
                    direction.normalize()
                );

                mesh.add(cylinderMesh);
                edgesAdded++;
            }

            edges.dispose();

            if (edgesAdded === 0) {
                console.warn('⚠️ No se encontraron bordes en el BREP');
            }
        } catch (error) {
            console.warn('⚠️ Error al extraer boundaries del BREP:', error);
        }
    }

    createSurfaceLabel(brepMesh, layer, nn) {
        try {
            // Calcular centroide del mesh
            const geometry = brepMesh.geometry;
            geometry.computeBoundingBox();
            const boundingBox = geometry.boundingBox;
            const centroid = new THREE.Vector3();
            boundingBox.getCenter(centroid);

            // Calcular la normal promedio de la superficie
            geometry.computeVertexNormals();
            const normals = geometry.attributes.normal;
            const avgNormal = new THREE.Vector3(0, 0, 0);

            for (let i = 0; i < normals.count; i++) {
                avgNormal.x += normals.getX(i);
                avgNormal.y += normals.getY(i);
                avgNormal.z += normals.getZ(i);
            }
            avgNormal.divideScalar(normals.count).normalize();

            // Crear label con formato: "XX-nn" (ej: "01-5", similar a gsCuales línea 48)
            const layerShortName = layer.fullPath.replace('GS::', '').replace('S3::', '');
            const labelText = `${layerShortName}-${nn}`;

            // Crear sprite para el label
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.width = 256;
            canvas.height = 64;

            // Fondo semi-transparente con color de capa
            context.fillStyle = `rgba(${layer.color.r}, ${layer.color.g}, ${layer.color.b}, 0.8)`;
            context.fillRect(0, 0, canvas.width, canvas.height);

            context.fillStyle = 'white';
            context.font = 'Bold 28px Arial';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(labelText, canvas.width / 2, canvas.height / 2);

            const texture = new THREE.CanvasTexture(canvas);
            const material = new THREE.SpriteMaterial({
                map: texture,
                depthTest: false,  // Renderizar siempre encima
                depthWrite: false
            });
            const sprite = new THREE.Sprite(material);

            sprite.position.copy(centroid);
            // Escala más pequeña para las etiquetas (ajustada para que sean legibles pero no enormes)
            sprite.scale.set(0.3, 0.075, 1);
            sprite.renderOrder = 999;  // Renderizar al final (encima de todo)
            sprite.visible = false;  // Ocultas por defecto
            sprite.userData = {
                isSurfaceLabel: true,
                layerName: layer.name,
                nn: nn
            };

            this.scene.add(sprite);
            layer.objects.push(sprite);

            // Guardar label con su normal para actualizar visibilidad
            this.surfaceLabels.push({
                sprite: sprite,
                mesh: brepMesh,
                normal: avgNormal,
                centroid: centroid.clone()
            });
        } catch (error) {
            console.warn('⚠️ Error al crear label de superficie:', error);
        }
    }

    convertGeometry(geometry, layer) {
        const objectType = geometry.objectType;
        const color = new THREE.Color(layer.color.r / 255, layer.color.g / 255, layer.color.b / 255);

        try {
            if (objectType === this.rhino.ObjectType.Brep || objectType === this.rhino.ObjectType.Extrusion) {
                return this.convertBrep(geometry, color);
            } else if (objectType === this.rhino.ObjectType.Mesh) {
                return this.convertMesh(geometry, color);
            } else if (objectType === this.rhino.ObjectType.Curve) {
                return this.convertCurve(geometry, color);
            } else if (objectType === this.rhino.ObjectType.Point) {
                return this.convertPoint(geometry, color);
            }
        } catch (error) {
            console.warn('⚠️ Error al convertir geometría:', error);
        }

        return null;
    }

    convertBrep(brep, color) {
        // En rhino3dm.js, los BREPs no tienen render meshes por defecto
        // Intentar obtener el mesh de render si existe
        try {
            const meshes = brep.getMesh(this.rhino.MeshType.Render);
            if (meshes && this.getCount(meshes) > 0) {
                // Combinar todos los meshes en uno solo
                const firstMesh = this.getItem(meshes, 0);
                return this.convertMesh(firstMesh, color);
            }
        } catch (e) {
            // Si no hay mesh de render, intentar crear uno simple
            console.warn('No render mesh disponible para BREP, omitiendo...');
        }
        return null;
    }

    convertMesh(rhinoMesh, color) {
        const geometry = new THREE.BufferGeometry();

        // Vertices - Convertir de Rhino (Z-up) a Three.js (Y-up)
        const vertices = [];
        const rhinoVertices = rhinoMesh.vertices();
        const vertexCount = this.getCount(rhinoVertices);

        for (let i = 0; i < vertexCount; i++) {
            const v = this.getItem(rhinoVertices, i);
            // Rhino: X, Y, Z -> Three.js: X, Z, -Y (Z-up a Y-up)
            vertices.push(v[0], v[2], -v[1]);
        }
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

        // Faces
        const indices = [];
        const rhinoFaces = rhinoMesh.faces();
        const faceCount = this.getCount(rhinoFaces);

        for (let i = 0; i < faceCount; i++) {
            const face = this.getItem(rhinoFaces, i);
            indices.push(face[0], face[1], face[2]);
            if (face[2] !== face[3]) {
                indices.push(face[0], face[2], face[3]);
            }
        }
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        // Material
        const material = new THREE.MeshPhongMaterial({
            color: color,
            side: THREE.DoubleSide,
            flatShading: false
        });

        return new THREE.Mesh(geometry, material);
    }

    convertCurve(curve, color) {
        // TEMPORALMENTE OMITIR CURVAS para debug de compatibilidad WebGL
        console.log('⏭️ Curva omitida (debug WebGL)');
        return null;
    }

    convertPoint(point, color) {
        const geometry = new THREE.SphereGeometry(0.1, 8, 8);
        const material = new THREE.MeshBasicMaterial({ color: color });
        const sphere = new THREE.Mesh(geometry, material);

        const location = point.location;
        // Convertir de Rhino (Z-up) a Three.js (Y-up)
        sphere.position.set(location[0], location[2], -location[1]);

        return sphere;
    }

    processDots() {
        const objects = this.doc.objects();
        const objectCount = this.getCount(objects);

        for (let i = 0; i < objectCount; i++) {
            const obj = this.getItem(objects, i);
            const geometry = obj.geometry();
            const attributes = obj.attributes();

            if (geometry.objectType === this.rhino.ObjectType.TextDot) {
                const dotData = {
                    text: geometry.text,
                    point: geometry.point,
                    layerIndex: attributes.layerIndex,
                    userStrings: this.getUserStrings(attributes)
                };

                this.dots.push(dotData);
                this.createDotSprite(dotData);
            }
        }
    }

    createDotSprite(dotData) {
        // Crear sprite para el dot
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;

        context.fillStyle = '#667eea';
        context.fillRect(0, 0, canvas.width, canvas.height);

        context.fillStyle = 'white';
        context.font = 'Bold 24px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(dotData.text, canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(material);

        // Convertir de Rhino (Z-up) a Three.js (Y-up)
        sprite.position.set(dotData.point[0], dotData.point[2], -dotData.point[1]);
        sprite.scale.set(2, 0.5, 1);
        sprite.userData = { isDot: true, dotData: dotData };

        this.scene.add(sprite);
        dotData.sprite = sprite;
    }

    getUserStrings(attributes) {
        const userStrings = {};

        try {
            // En rhino3dm v8.0.1, getUserStrings() devuelve un array de arrays [key, value]
            const strings = attributes.getUserStrings();

            if (strings && Array.isArray(strings)) {
                // Si es un array de pares [key, value]
                for (let i = 0; i < strings.length; i++) {
                    if (Array.isArray(strings[i]) && strings[i].length >= 2) {
                        userStrings[strings[i][0]] = strings[i][1];
                    }
                }
            } else if (strings && typeof strings === 'object') {
                // Si es un objeto con métodos getKey/getValue (versiones antiguas)
                const stringCount = this.getCount(strings);
                for (let i = 0; i < stringCount; i++) {
                    if (typeof strings.getKey === 'function') {
                        const key = strings.getKey(i);
                        const value = strings.getValue(i);
                        userStrings[key] = value;
                    }
                }
            }
        } catch (e) {
            console.warn('⚠️ Error obteniendo user strings:', e.message);
        }

        return userStrings;
    }

    updateFileInfo(file) {
        const fileInfo = document.getElementById('fileInfo');
        const objectCount = this.getCount(this.doc.objects());
        const layerCount = this.getCount(this.doc.layers());

        let fileName, sizeKB;
        if (typeof file === 'string') {
            fileName = file;
            sizeKB = null;
        } else {
            fileName = file.name;
            sizeKB = (file.size / 1024).toFixed(2);
        }

        let html = `
            <div class="info-row">
                <span class="info-label">Archivo:</span>
                <span>${fileName}</span>
            </div>`;

        if (sizeKB) {
            html += `
            <div class="info-row">
                <span class="info-label">Tamaño:</span>
                <span>${sizeKB} KB</span>
            </div>`;
        }

        html += `
            <div class="info-row">
                <span class="info-label">Objetos:</span>
                <span>${objectCount}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Capas:</span>
                <span>${layerCount}</span>
            </div>
        `;

        fileInfo.innerHTML = html;
    }

    updateLayerList() {
        const layerList = document.getElementById('layerList');
        layerList.innerHTML = '';

        this.layers.forEach((layer, index) => {
            const layerItem = document.createElement('div');
            layerItem.className = 'layer-item';
            layerItem.dataset.layerIndex = index;

            const colorDiv = document.createElement('div');
            colorDiv.className = 'layer-color';
            colorDiv.style.backgroundColor = `rgb(${layer.color.r}, ${layer.color.g}, ${layer.color.b})`;

            const nameSpan = document.createElement('span');
            nameSpan.className = 'layer-name';
            nameSpan.textContent = `${layer.fullPath || layer.name} (${layer.objects.length})`;

            const toggleSpan = document.createElement('span');
            toggleSpan.className = 'layer-toggle';
            toggleSpan.textContent = layer.visible ? '👁️' : '🚫';

            layerItem.appendChild(colorDiv);
            layerItem.appendChild(nameSpan);
            layerItem.appendChild(toggleSpan);

            layerItem.addEventListener('click', () => {
                this.toggleLayer(index);
            });

            layerList.appendChild(layerItem);
        });
    }

    updateDotsList() {
        const dotsList = document.getElementById('dotsList');

        if (this.dots.length === 0) {
            dotsList.innerHTML = '<p class="empty-state">No hay dots en el archivo</p>';
            return;
        }

        dotsList.innerHTML = '';

        this.dots.forEach((dot, index) => {
            const dotItem = document.createElement('div');
            dotItem.className = 'dot-item';

            let html = `<div class="dot-text">${dot.text}</div>`;

            if (Object.keys(dot.userStrings).length > 0) {
                html += '<div style="margin-top: 0.3rem; font-size: 0.75rem; color: #aaa;">';
                for (const [key, value] of Object.entries(dot.userStrings)) {
                    html += `<div>${key}: ${value}</div>`;
                }
                html += '</div>';
            }

            dotItem.innerHTML = html;
            dotsList.appendChild(dotItem);
        });
    }

    updateEdgeWidth() {
        // Recargar el archivo para aplicar el nuevo grosor de bordes
        if (this.doc) {
            this.clearScene();
            this.processLayers();
            this.processObjectsWithMeshes();
            this.processDots();
            this.updateLayerList();
            this.updateDotsList();
            this.fitCameraToScene();
        }
    }

    onDoubleClick(event) {
        try {
            // Calcular posición del mouse/touch en coordenadas normalizadas (-1 a +1)
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            // Actualizar el raycaster
            this.raycaster.setFromCamera(this.mouse, this.camera);

            // Obtener todos los meshes de la escena (solo Breps, no bordes)
            const meshes = [];
            this.scene.traverse((child) => {
                if (child.isMesh && child.userData && child.userData.objectType === this.rhino.ObjectType.Brep) {
                    meshes.push(child);
                }
            });

            if (meshes.length === 0) {
                console.warn('⚠️ No hay Breps en la escena');
                return;
            }

            // Calcular intersecciones
            const intersects = this.raycaster.intersectObjects(meshes, false);

            if (intersects.length > 0) {
                const mesh = intersects[0].object;
                const userData = mesh.userData;

                if (!userData || !userData.layerId) {
                    console.warn('⚠️ Objeto sin userData válido');
                    return;
                }

                // Obtener la capa usando el layerId
                const layerData = this.layers.get(userData.layerId);
                if (!layerData) {
                    console.warn('⚠️ No se encontró la capa para el objeto clickeado');
                    return;
                }

                // Obtener el nn del usertext
                const nn = userData.userStrings?.nn || 'sin nn';

                // Crear el texto CAPA-NN
                const layerShortName = layerData.fullPath.replace('GS::', '').replace('S3::', '');
                const labelText = `${layerShortName}-${nn}`;

                // Mostrar en el panel de información
                const objectInfo = document.getElementById('objectInfo');
                if (objectInfo) {
                    objectInfo.innerHTML = `
                        <div style="padding: 0.5rem; background: rgba(102, 126, 234, 0.2); border-radius: 4px;">
                            <div style="font-size: 1.2rem; font-weight: bold; color: #667eea; margin-bottom: 0.5rem;">
                                ${labelText}
                            </div>
                            <div style="font-size: 0.85rem; color: #aaa;">
                                <div>Capa: ${layerData.fullPath}</div>
                                <div>Tipo: Brep</div>
                                ${nn !== 'sin nn' ? `<div>nn: ${nn}</div>` : ''}
                            </div>
                        </div>
                    `;
                }

                // Crear un sprite temporal que se muestre por 3 segundos
                this.showTemporaryLabel(intersects[0].point, labelText, layerData, mesh);
            }
        } catch (error) {
            console.error('❌ Error en onDoubleClick:', error);
        }
    }

    showTemporaryLabel(position, text, layer, mesh) {
        // Oscurecer el mesh temporalmente
        let originalColor = null;
        if (mesh && mesh.material) {
            originalColor = mesh.material.color.clone();
            // Oscurecer al 70% del brillo original
            mesh.material.color.multiplyScalar(0.7);
        }

        // Crear sprite temporal con alta resolución para evitar blur
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        // Usar escala 4x para mayor resolución (evita blur al escalar)
        const scale = 4;

        // Medir el texto primero para ajustar el canvas - 20% más pequeño
        const fontSize = 38; // 48 * 0.8 = 38.4 ≈ 38 (20% más pequeño)
        context.font = `Bold ${fontSize * scale}px Arial`;
        const metrics = context.measureText(text);
        const textWidth = metrics.width;

        // Canvas ajustado al texto con padding mínimo
        const padding = 12 * scale; // Padding muy reducido
        canvas.width = textWidth + padding * 2;
        canvas.height = 56 * scale; // Altura más compacta

        // Dibujar rectángulo con bordes redondeados
        const borderRadius = 20 * scale; // Radio de esquinas redondeadas

        context.beginPath();
        context.moveTo(borderRadius, 0);
        context.lineTo(canvas.width - borderRadius, 0);
        context.quadraticCurveTo(canvas.width, 0, canvas.width, borderRadius);
        context.lineTo(canvas.width, canvas.height - borderRadius);
        context.quadraticCurveTo(canvas.width, canvas.height, canvas.width - borderRadius, canvas.height);
        context.lineTo(borderRadius, canvas.height);
        context.quadraticCurveTo(0, canvas.height, 0, canvas.height - borderRadius);
        context.lineTo(0, borderRadius);
        context.quadraticCurveTo(0, 0, borderRadius, 0);
        context.closePath();

        // Color más oscuro para la etiqueta (70% del brillo original)
        const darkerR = Math.floor(layer.color.r * 0.7);
        const darkerG = Math.floor(layer.color.g * 0.7);
        const darkerB = Math.floor(layer.color.b * 0.7);

        context.fillStyle = `rgba(${darkerR}, ${darkerG}, ${darkerB}, 0.95)`;
        context.fill();

        // Texto blanco
        context.fillStyle = 'white';
        context.font = `Bold ${fontSize * scale}px Arial`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({
            map: texture,
            depthTest: false,
            depthWrite: false
        });
        const sprite = new THREE.Sprite(material);

        sprite.position.copy(position);

        // Calcular escala basada en la distancia de la cámara
        const distance = this.camera.position.distanceTo(position);
        const scaleFactor = distance * 0.05; // Tamaño ajustado
        const aspectRatio = canvas.width / canvas.height;
        sprite.scale.set(scaleFactor * aspectRatio, scaleFactor, 1);
        sprite.renderOrder = 1000;

        this.scene.add(sprite);

        // Actualizar escala en cada frame para mantener tamaño constante
        const updateScale = () => {
            if (sprite.parent) {
                const dist = this.camera.position.distanceTo(sprite.position);
                const scale = dist * 0.05;
                sprite.scale.set(scale * aspectRatio, scale, 1);
            }
        };

        // Agregar a la lista de sprites que necesitan actualización
        if (!this.dynamicSprites) {
            this.dynamicSprites = [];
        }
        this.dynamicSprites.push({ sprite, updateScale });

        // Eliminar después de 3 segundos
        setTimeout(() => {
            this.scene.remove(sprite);
            texture.dispose();
            material.dispose();

            // Restaurar color original del mesh
            if (mesh && mesh.material && originalColor) {
                mesh.material.color.copy(originalColor);
            }

            // Remover de la lista de sprites dinámicos
            const index = this.dynamicSprites.findIndex(s => s.sprite === sprite);
            if (index !== -1) {
                this.dynamicSprites.splice(index, 1);
            }
        }, 3000);
    }

    toggleLayer(layerIndex) {
        const layer = this.layers.get(layerIndex);
        if (!layer) return;

        layer.visible = !layer.visible;

        layer.objects.forEach(obj => {
            obj.visible = layer.visible;
        });

        this.updateLayerList();
    }

    filterLayers(searchTerm) {
        const layerItems = document.querySelectorAll('.layer-item');
        const term = searchTerm.toLowerCase();

        layerItems.forEach(item => {
            const layerName = item.querySelector('.layer-name').textContent.toLowerCase();
            if (layerName.includes(term)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
    }

    toggleSurfaceLabels(show) {
        // Mostrar/ocultar labels de superficies con usertext "nn"
        this.scene.traverse((child) => {
            if (child.isSprite && child.userData.isSurfaceLabel) {
                child.visible = show;
            }
        });
    }

    toggleDots(show) {
        this.dots.forEach(dot => {
            if (dot.sprite) {
                dot.sprite.visible = show;
            }
        });
    }

    toggleUserText(show) {
        // Esta función podría expandirse para mostrar usertext de superficies
        console.log('Toggle UserText:', show);
    }

    resetView() {
        this.camera.position.set(10, 10, 10);
        this.camera.lookAt(0, 0, 0);
        this.controls.reset();
    }

    setTopView() {
        const bbox = this.getSceneBoundingBox();
        const center = bbox.getCenter(new THREE.Vector3());
        const size = bbox.getSize(new THREE.Vector3());

        this.camera.position.set(center.x, center.y + size.y * 2, center.z);
        this.camera.lookAt(center);
        this.controls.target.copy(center);
    }

    setFrontView() {
        const bbox = this.getSceneBoundingBox();
        const center = bbox.getCenter(new THREE.Vector3());
        const size = bbox.getSize(new THREE.Vector3());

        this.camera.position.set(center.x, center.y, center.z + size.z * 2);
        this.camera.lookAt(center);
        this.controls.target.copy(center);
    }

    toggleWireframe() {
        this.wireframeMode = !this.wireframeMode;

        this.scene.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material.wireframe = this.wireframeMode;
            }
        });
    }

    fitCameraToScene() {
        const bbox = this.getSceneBoundingBox();

        // Verificar que el bounding box sea válido
        if (bbox.isEmpty()) {
            console.warn('⚠️ No hay objetos para hacer zoom extents');
            return;
        }

        const center = bbox.getCenter(new THREE.Vector3());
        const size = bbox.getSize(new THREE.Vector3());

        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.camera.fov * (Math.PI / 180);
        let cameraDistance = Math.abs(maxDim / 2 / Math.tan(fov / 2));

        // Ajustar distancia para que se vea todo con un poco de margen
        cameraDistance *= 1.2;

        // Posicionar cámara en vista isométrica (arriba-derecha-frente)
        const offset = cameraDistance / Math.sqrt(3);
        this.camera.position.set(
            center.x + offset,
            center.y + offset,
            center.z + offset
        );

        this.camera.lookAt(center);
        this.controls.target.copy(center);
        this.controls.update();

        console.log('📐 Zoom extents aplicado:', {
            center: center,
            size: size,
            distance: cameraDistance
        });
    }

    getSceneBoundingBox() {
        const bbox = new THREE.Box3();

        // Solo considerar Breps para el bounding box (no bordes, no helpers)
        this.scene.traverse((child) => {
            if (child.isMesh && child.userData.objectType === this.rhino.ObjectType.Brep) {
                bbox.expandByObject(child);
            }
        });

        return bbox;
    }

    onWindowResize() {
        const container = document.getElementById('viewer');
        this.camera.aspect = container.clientWidth / container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(container.clientWidth, container.clientHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();

        // Actualizar visibilidad de labels según orientación de cámara
        this.updateSurfaceLabelsVisibility();

        // Actualizar escala de sprites dinámicos (etiquetas temporales)
        if (this.dynamicSprites && this.dynamicSprites.length > 0) {
            this.dynamicSprites.forEach(item => item.updateScale());
        }

        this.renderer.render(this.scene, this.camera);
    }

    updateSurfaceLabelsVisibility() {
        // Vector de dirección de la cámara
        const cameraDirection = new THREE.Vector3();
        this.camera.getWorldDirection(cameraDirection);

        this.surfaceLabels.forEach(labelData => {
            // Calcular vector desde la cámara al centroide
            const toCentroid = new THREE.Vector3();
            toCentroid.subVectors(labelData.centroid, this.camera.position).normalize();

            // Calcular el producto punto entre la normal de la superficie y el vector hacia la cámara
            // Si el ángulo es < 90° (dot > 0), la superficie está mirando hacia la cámara
            const dot = labelData.normal.dot(toCentroid.negate());

            // Mostrar label solo si la superficie está frente a la cámara
            labelData.sprite.visible = dot > 0.1; // Umbral de 0.1 para evitar parpadeo
        });
    }

    showLoading(show) {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.style.display = show ? 'flex' : 'none';
        }
    }

    async loadAvailableFiles() {
        try {
            console.log('🔍 Cargando lista de archivos...');

            const container = document.getElementById('availableFiles');
            if (!container) {
                console.error('❌ No se encontró el elemento availableFiles en el DOM');
                return;
            }

            console.log('🔄 Haciendo fetch a /api/files...');

            // Fetch con timeout de 10 segundos
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await fetch('/api/files', { signal: controller.signal });
            clearTimeout(timeoutId);

            console.log('📡 Response recibido, status:', response.status, 'ok:', response.ok);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            console.log('🔄 Parseando JSON...');
            const files = await response.json();
            console.log('📁 Archivos recibidos:', files);
            console.log('📁 Tipo de files:', typeof files, 'Es array:', Array.isArray(files));

            if (!Array.isArray(files)) {
                console.error('❌ La respuesta no es un array:', files);
                container.innerHTML = '<p class="empty-state">Error: respuesta inválida del servidor</p>';
                return;
            }

            if (files.length === 0) {
                console.warn('⚠️ No hay archivos disponibles');
                container.innerHTML = '<p class="empty-state">No hay archivos disponibles</p>';
                return;
            }

            console.log('🔄 Limpiando contenedor...');
            container.innerHTML = '';

            console.log('🔄 Creando elementos para', files.length, 'archivos...');
            files.forEach((file, index) => {
                try {
                    console.log(`  📄 Procesando archivo ${index + 1}:`, file.name);

                    const fileItem = document.createElement('div');
                    fileItem.className = 'file-item';

                    const fileName = document.createElement('span');
                    fileName.className = 'file-item-name';
                    fileName.textContent = file.name || 'Sin nombre';

                    const fileInfo = document.createElement('span');
                    fileInfo.className = 'file-item-info';
                    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
                    fileInfo.textContent = `${sizeMB} MB`;

                    fileItem.appendChild(fileName);
                    fileItem.appendChild(fileInfo);

                    fileItem.addEventListener('click', () => {
                        console.log('🖱️ Click en archivo:', file.name);
                        this.loadFileFromServer(file.path);
                    });

                    container.appendChild(fileItem);
                } catch (itemError) {
                    console.error(`❌ Error procesando archivo ${index}:`, itemError);
                }
            });

            console.log(`✅ ${files.length} archivo(s) disponible(s) mostrados en UI`);
        } catch (error) {
            console.error('❌ Error al cargar lista de archivos:', error);
            console.error('❌ Error name:', error.name);
            console.error('❌ Error message:', error.message);
            console.error('❌ Stack:', error.stack);

            let errorMessage = 'Error al cargar archivos';
            if (error.name === 'AbortError') {
                errorMessage = 'Timeout: El servidor no respondió en 10 segundos';
            } else if (error.message.includes('Failed to fetch')) {
                errorMessage = 'No se puede conectar con el servidor. Verifica la conexión de red.';
            } else {
                errorMessage = `Error: ${error.message}`;
            }

            const container = document.getElementById('availableFiles');
            if (container) {
                container.innerHTML = `<p class="empty-state">${errorMessage}</p>`;
            }
        }
    }

    processObjectsWithMeshes() {
        try {
            console.log('🔄 [processObjectsWithMeshes] Iniciando...');

            if (!this.doc) {
                throw new Error('No hay documento cargado');
            }

            const objects = this.doc.objects();
            if (!objects) {
                throw new Error('No se pudieron obtener los objetos del documento');
            }

            const objectCount = this.getCount(objects);
            console.log('🔍 Procesando', objectCount, 'objetos...');

            let processedCount = 0;
            let skippedCount = 0;
            let skippedByType = {};
            let processedByType = {};
            let skippedByLayer = {};

            for (let i = 0; i < objectCount; i++) {
                try {
                    const obj = this.getItem(objects, i);
                    if (!obj) {
                        console.warn(`⚠️ Objeto ${i} es null`);
                        skippedCount++;
                        continue;
                    }

                    const attributes = obj.attributes();
                    const geometry = obj.geometry();

                    if (!attributes || !geometry) {
                        console.warn(`⚠️ Objeto ${i} sin attributes o geometry`);
                        skippedCount++;
                        continue;
                    }

            // Obtener capa por layerIndex
            const layerIndex = attributes.layerIndex;

            // Buscar la capa en el documento y luego en nuestro Map filtrado
            const docLayer = this.getItem(this.doc.layers(), layerIndex);
            if (!docLayer) {
                skippedCount++;
                continue;
            }

            const layer = this.layers.get(docLayer.id);
            if (!layer) {
                skippedCount++;
                // Contar por tipo de objeto para debug
                const objType = geometry.objectType;
                const typeName = Object.keys(this.rhino.ObjectType).find(key => this.rhino.ObjectType[key] === objType) || 'Unknown';
                skippedByType[typeName] = (skippedByType[typeName] || 0) + 1;

                // Debug: mostrar primeras capas omitidas y TODOS los Breps omitidos
                if (skippedCount <= 5 || typeName === 'Brep') {
                    console.log(`  ⏭️ Objeto omitido - Capa: ${docLayer.fullPath}, Tipo: ${typeName}`);
                }
                skippedByLayer[docLayer.fullPath] = (skippedByLayer[docLayer.fullPath] || 0) + 1;
                continue;
            }

            // Convertir geometría a mesh
            let mesh = null;
            const objectType = geometry.objectType;

            // Para BREPs, crear mesh como lo hace Rhino3dmLoader
            if (objectType === this.rhino.ObjectType.Brep) {
                if (processedCount < 3) {
                    console.log('🔧 Convirtiendo BREP en capa:', layer.fullPath);
                }

                try {
                    const faces = geometry.faces();
                    const combinedMesh = new this.rhino.Mesh();

                    for (let faceIndex = 0; faceIndex < faces.count; faceIndex++) {
                        const face = faces.get(faceIndex);
                        const faceMesh = face.getMesh(this.rhino.MeshType.Any);

                        if (faceMesh) {
                            combinedMesh.append(faceMesh);
                            faceMesh.delete();
                        }
                        face.delete();
                    }

                    if (combinedMesh.faces().count > 0) {
                        combinedMesh.compact();

                        if (processedCount < 3) {
                            console.log('  📐 Mesh creado con', combinedMesh.faces().count, 'caras');
                        }

                        // Convertir el color de la capa a THREE.Color
                        let color = new THREE.Color(layer.color.r / 255, layer.color.g / 255, layer.color.b / 255);

                        // Si el color es muy oscuro (casi negro), usar gris claro
                        const brightness = (layer.color.r + layer.color.g + layer.color.b) / 3;
                        if (brightness < 30) {
                            color = new THREE.Color(0.7, 0.7, 0.7); // Gris claro
                        }

                        mesh = this.convertMesh(combinedMesh, color);

                        // Extraer y agregar boundary curves del Brep original
                        if (mesh) {
                            this.addBrepBoundaries(geometry, mesh, layer);
                        }

                        if (processedCount < 3) {
                            console.log('  ✅ BREP convertido a mesh con bordes');
                        }
                    } else {
                        if (processedCount < 3) {
                            console.log('  ⚠️ BREP sin caras válidas');
                        }
                    }

                    faces.delete();
                    combinedMesh.delete();
                } catch (e) {
                    console.error('  ❌ Error convirtiendo BREP:', e.message);
                }
            } else {
                // Para otros tipos de geometría, usar el método original
                mesh = this.convertGeometry(geometry, layer);
            }

            if (mesh) {
                const userStrings = this.getUserStrings(attributes);

                mesh.userData = {
                    rhinoId: attributes.id,
                    layerIndex: layerIndex,
                    layerId: docLayer.id,  // Agregar el ID de la capa para el doble click
                    layerName: layer.name,
                    objectType: geometry.objectType,
                    userStrings: userStrings
                };

                this.scene.add(mesh);
                this.objects.set(attributes.id, mesh);
                layer.objects.push(mesh);
                processedCount++;

                // Contar por tipo de objeto procesado
                const objType = geometry.objectType;
                const typeName = Object.keys(this.rhino.ObjectType).find(key => this.rhino.ObjectType[key] === objType) || 'Unknown';
                processedByType[typeName] = (processedByType[typeName] || 0) + 1;

                // Etiquetas deshabilitadas - molestan demasiado
                // if (userStrings.nn && objectType === this.rhino.ObjectType.Brep) {
                //     this.createSurfaceLabel(mesh, layer, userStrings.nn);
                // }
            }
            } catch (objError) {
                console.error(`❌ Error procesando objeto ${i}:`, objError);
                skippedCount++;
            }
        } // Cierre del for loop

        console.log('📊 Objetos procesados:', processedCount);
        console.log('✅ Objetos procesados por tipo:', processedByType);
        console.log('⏭️ Objetos omitidos (capa no visible):', skippedCount);
        console.log('❌ Objetos omitidos por tipo:', skippedByType);
        console.log('📋 Objetos omitidos por capa:', skippedByLayer);

        // Mostrar específicamente las capas con Breps omitidos
        console.log('🔍 Capas con Breps omitidos:');
        Object.entries(skippedByLayer).forEach(([layerName, count]) => {
            if (layerName.startsWith('GS::') || layerName.startsWith('S3::') || layerName === 'GS' || layerName === 'S3') {
                console.log(`  ⚠️ ${layerName}: ${count} objetos`);
            }
        });
        } catch (error) {
            console.error('❌ Error crítico en processObjectsWithMeshes:', error);
            console.error('❌ Stack:', error.stack);
            throw error; // Re-lanzar para que se capture en loadFile
        }
    }

    processRhino3dmObject(object) {
        // El objeto ya viene con los meshes convertidos por Rhino3dmLoader
        const layers = object.userData.layers;

        console.log('🔍 Procesando objeto de Rhino3dmLoader...');
        console.log('📋 Total capas en archivo:', layers.length);

        // Crear mapa de capas filtradas
        this.layers.clear();
        layers.forEach((layerData, index) => {
            const fullPath = layerData.fullPath || layerData.name;

            if (this.shouldShowLayer(fullPath)) {
                this.layers.set(layerData.id, {
                    name: layerData.name,
                    fullPath: fullPath,
                    color: layerData.color,
                    visible: layerData.visible,
                    index: index,
                    id: layerData.id,
                    objects: []
                });
                console.log('✅ Capa aceptada:', fullPath);
            }
        });

        console.log('📋 Total capas filtradas:', this.layers.size);

        // Recorrer todos los meshes del objeto
        let processedCount = 0;
        let skippedCount = 0;

        object.traverse((child) => {
            if (child.isMesh || child.isLine || child.isPoints) {
                const attributes = child.userData.attributes;

                if (attributes) {
                    const layerIndex = attributes.layerIndex;
                    const layerData = layers[layerIndex];

                    if (layerData) {
                        const layer = this.layers.get(layerData.id);

                        if (layer) {
                            // Agregar el mesh a la escena
                            this.scene.add(child.clone());
                            layer.objects.push(child);
                            processedCount++;
                        } else {
                            skippedCount++;
                        }
                    }
                }
            }
        });

        console.log('📊 Objetos procesados:', processedCount);
        console.log('⏭️ Objetos omitidos:', skippedCount);

        // Actualizar lista de capas
        this.updateLayerList();
    }

    async loadFileFromServer(filePath) {
        try {
            this.showLoading(true);

            const response = await fetch(filePath);
            const arrayBuffer = await response.arrayBuffer();
            const arr = new Uint8Array(arrayBuffer);

            // Leer archivo con rhino3dm
            this.doc = this.rhino.File3dm.fromByteArray(arr);

            console.log('✅ Archivo cargado:', filePath);
            console.log('📊 Objetos:', this.getCount(this.doc.objects()), '| Capas:', this.getCount(this.doc.layers()));

            // Limpiar escena anterior
            this.clearScene();

            // Procesar archivo
            this.processLayers();
            this.processObjectsWithMeshes();
            this.processDots();

            // Actualizar UI
            this.updateLayerList();
            this.updateDotsList();
            this.updateFileInfo(filePath.split('/').pop());

            // Ajustar cámara
            this.fitCameraToScene();

            this.showLoading(false);
        } catch (error) {
            console.error('❌ Error al cargar archivo:', error);
            alert('Error al cargar el archivo: ' + error.message);
            this.showLoading(false);
        }
    }

    // Función para cargar desde Android via Base64
    async loadFromBase64(base64String, fileName) {
        try {
            console.log('📱 Cargando archivo desde Android:', fileName);
            console.log('📦 Base64 length:', base64String.length);
            this.showLoading(true);

            // Esperar a que rhino3dm esté listo
            let waitCount = 0;
            while (!this.rhino && waitCount < 50) {
                console.log('⏳ Esperando rhino3dm...', waitCount);
                await new Promise(resolve => setTimeout(resolve, 100));
                waitCount++;
            }

            if (!this.rhino) {
                throw new Error('rhino3dm no está inicializado');
            }

            // Liberar documento anterior si existe
            if (this.doc) {
                console.log('🧹 Liberando documento anterior...');
                try { this.doc.delete(); } catch (e) { console.warn('No se pudo eliminar doc anterior'); }
                this.doc = null;
            }

            // Decodificar Base64 a ArrayBuffer
            console.log('🔄 Decodificando Base64...');
            const binaryString = atob(base64String);
            const len = binaryString.length;
            console.log('📦 Bytes a procesar:', len);
            console.log('📦 MB a procesar:', (len / (1024 * 1024)).toFixed(2));

            // Verificar tamaño máximo (50MB)
            const MAX_FILE_SIZE = 50 * 1024 * 1024;
            if (len > MAX_FILE_SIZE) {
                throw new Error(`Archivo demasiado grande. Máximo: 50MB, Archivo: ${(len / (1024 * 1024)).toFixed(2)}MB`);
            }

            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            console.log('✅ Base64 decodificado, bytes:', bytes.length);

            // Dar tiempo al UI de actualizar
            await new Promise(resolve => setTimeout(resolve, 100));

            // Leer archivo con rhino3dm
            console.log('🔄 Parseando con rhino3dm...');
            this.doc = this.rhino.File3dm.fromByteArray(bytes);

            console.log('✅ Archivo cargado:', fileName);
            console.log('📊 Objetos:', this.getCount(this.doc.objects()), '| Capas:', this.getCount(this.doc.layers()));

            // Dar tiempo al UI
            await new Promise(resolve => setTimeout(resolve, 50));

            // Limpiar escena anterior
            console.log('🧹 Limpiando escena...');
            this.clearScene();

            // Procesar archivo
            console.log('🔄 Procesando capas...');
            this.processLayers();

            await new Promise(resolve => setTimeout(resolve, 50));

            console.log('🔄 Procesando objetos...');
            this.processObjectsWithMeshes();

            await new Promise(resolve => setTimeout(resolve, 50));

            console.log('🔄 Procesando dots...');
            this.processDots();

            // Actualizar UI
            console.log('🔄 Actualizando UI...');
            this.updateLayerList();
            this.updateDotsList();
            this.updateFileInfo(fileName);

            // Ajustar cámara
            console.log('📐 Ajustando cámara...');
            this.fitCameraToScene();

            this.showLoading(false);
            console.log('🎉 Carga completada exitosamente');

            // Notificar a Android que se cargó correctamente
            if (window.Android && window.Android.onModelLoaded) {
                window.Android.onModelLoaded(fileName);
            }
        } catch (error) {
            console.error('❌ Error al cargar archivo desde Base64:', error);
            console.error('❌ Stack:', error.stack);
            this.showLoading(false);

            // Mostrar error en pantalla
            const errorDiv = document.createElement('div');
            errorDiv.style.cssText = 'position:fixed;top:50px;left:10px;right:10px;background:red;color:white;padding:15px;z-index:9999;font-size:11px;max-height:300px;overflow:auto;';
            errorDiv.innerHTML = `
                <strong>Error al cargar archivo:</strong><br>
                ${error.name}: ${error.message}<br><br>
                <strong>Stack:</strong><br>
                ${error.stack ? error.stack.replace(/\n/g, '<br>') : 'No disponible'}
            `;
            document.body.appendChild(errorDiv);

            // Notificar error a Android
            if (window.Android && window.Android.onError) {
                window.Android.onError(error.message);
            }
        }
    }
}

// Botón para mostrar consola
document.addEventListener('DOMContentLoaded', () => {
    const showConsoleBtn = document.getElementById('showConsoleBtn');
    const consoleViewer = document.getElementById('consoleViewer');

    if (showConsoleBtn && consoleViewer) {
        showConsoleBtn.addEventListener('click', () => {
            consoleViewer.style.display = 'block';
            mobileConsole.updateViewer();
        });
    }
});

// Capturar errores globales para debugging en móviles
window.addEventListener('error', (e) => {
    console.error('❌ Error global:', e.error);
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = 'position:fixed;top:0;left:0;right:0;background:red;color:white;padding:10px;z-index:9999;font-size:12px;';
    errorDiv.textContent = `Error: ${e.message} - ${e.filename}:${e.lineno}`;
    document.body.appendChild(errorDiv);
});

// Inicializar aplicación cuando el DOM esté listo
if (document.readyState === 'loading') {
    console.log('⏳ Esperando a que el DOM esté listo...');
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    console.log('✅ DOM ya está listo, inicializando...');
    initApp();
}

function initApp() {
    try {
        console.log('🚀 Iniciando aplicación S3Viewer...');
        window.viewer = new S3Viewer();  // Guardar en window para acceso desde Android
        console.log('✅ S3Viewer instanciado y disponible en window.viewer');
    } catch (error) {
        console.error('❌ Error al inicializar S3Viewer:', error);
        console.error('❌ Stack:', error.stack);
        alert('Error al inicializar el visor: ' + error.message + '\n\nAbre el visor de consola (botón azul 📋) para más detalles.');
    }
}

