import { useState, useRef, useEffect } from 'react'
import './App.css'

function App() {
  const [selectedImages, setSelectedImages] = useState([])
  const [extractedText, setExtractedText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  // Refs for container and canvas
  const containerRef = useRef(null)
  const canvasRef = useRef(null)

  const handleImageChange = (event) => {
    const files = Array.from(event.target.files)
    if (selectedImages.length + files.length > 5) {
      setError('Maximum 5 images allowed')
      return
    }
    setSelectedImages(prev => [...prev, ...files])
    setError(null)
  }

  const handleRemoveImage = (index) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index))
  }

  const handleUpload = async () => {
    if (selectedImages.length === 0) {
      setError('Please select at least one image')
      return
    }

    setIsLoading(true)
    setError(null)

    const formData = new FormData()
    selectedImages.forEach(image => {
      formData.append('images', image)
    })

    try {
      const response = await fetch('http://localhost:5000/api/upload', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || data.message || 'Failed to process image')
      }

      const extractedTexts = data.data.results
        .map((result, index) => `Image ${index + 1}:\n${result.extractedText}`)
        .join('\n\n')
      setExtractedText(extractedTexts)
      
      if (data.data.failedFiles.length > 0) {
        setError(`Some files failed to process:\n${data.data.failedFiles.join('\n')}`)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    // Set canvas size to match container
    const setCanvasSize = () => {
      canvas.width = container.offsetWidth
      canvas.height = container.offsetHeight
    }

    setCanvasSize()

    let particlesArray = []
    const numberOfParticles = 70

    class Particle {
      constructor() {
        this.x = Math.random() * canvas.width
        this.y = Math.random() * canvas.height
        this.size = Math.random() * 6 + 3
        this.baseSize = this.size
        this.speedX = Math.random() * 2 - 1
        this.speedY = Math.random() * 2 - 1
        this.alpha = Math.random() * 0.5 + 0.3
        this.glowSize = this.size * 2
      }
      update() {
        this.x += this.speedX
        this.y += this.speedY
        // Bounce off edges with damping
        if (this.x < 0 || this.x > canvas.width) {
          this.speedX *= -0.9
          this.x = Math.max(0, Math.min(this.x, canvas.width))
        }
        if (this.y < 0 || this.y > canvas.height) {
          this.speedY *= -0.9
          this.y = Math.max(0, Math.min(this.y, canvas.height))
        }
        // Pulsing effect
        this.size = this.baseSize + Math.sin(Date.now() * 0.003) * 2
      }
      draw() {
        // Draw glow
        const gradient = ctx.createRadialGradient(
          this.x, this.y, 0,
          this.x, this.y, this.glowSize
        )
        gradient.addColorStop(0, `rgba(255, 255, 255, ${this.alpha})`)
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.arc(this.x, this.y, this.glowSize, 0, Math.PI * 2)
        ctx.fill()
        
        // Draw core
        ctx.fillStyle = `rgba(255, 255, 255, ${this.alpha + 0.3})`
        ctx.beginPath()
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const initParticles = () => {
      particlesArray = []
      for (let i = 0; i < numberOfParticles; i++) {
        const particle = new Particle()
        // Create a more focused distribution around the upload section
        if (i < numberOfParticles * 0.8) {
          const angle = Math.random() * Math.PI * 2
          const radius = Math.random() * canvas.width * 0.4
          particle.x = canvas.width / 2 + Math.cos(angle) * radius
          particle.y = canvas.height / 2 + Math.sin(angle) * radius
          particle.glowSize = particle.size * 3 // Larger glow for particles near the center
        }
        particlesArray.push(particle)
      }
    }

    initParticles()

    let animationFrameId
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      particlesArray.forEach((particle) => {
        particle.update()
        particle.draw()
      })
      animationFrameId = requestAnimationFrame(animate)
    }
    animate()

    const handleResize = () => {
      setCanvasSize()
      initParticles() // re-initialize for consistent distribution
    }
    window.addEventListener('resize', handleResize)

    return () => {
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  return (
    <div className="container" ref={containerRef} style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Canvas is positioned absolutely within the container */}
      <canvas 
        ref={canvasRef} 
        className="particles-canvas" 
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: -1 }}
      />

      <h1>IMAGE TO TEXT EXTRACTOR</h1>

      <div className="upload-section">
        <div className="upload-instructions">
          <p>Drag & drop images here or</p>
          <input
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            id="file-input"
            className="file-input"
            multiple
          />
          <label htmlFor="file-input" className="file-input-label">
            Choose Files
          </label>
          <p className="upload-limit">(Maximum 5 images)</p>
        </div>

        <div className="selected-files">
          {selectedImages.map((image, index) => (
            <div key={index} className="file-item">
              <span className="file-name">{image.name}</span>
              <button
                className="remove-button"
                onClick={() => handleRemoveImage(index)}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <button 
          onClick={handleUpload} 
          disabled={isLoading}
          className="upload-button"
        >
          {isLoading ? 'Processing...' : 'Extract Text'}
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      {extractedText && (
        <div className="text-result">
          <h4>Extracted Text</h4>
          <pre>{extractedText}</pre>
        </div>
      )}
    </div>
  )
}

export default App
